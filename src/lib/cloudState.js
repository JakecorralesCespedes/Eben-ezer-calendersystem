import { useEffect, useRef, useState } from 'react';
import { cloudConfigured, supabase } from './supabaseClient.js';
import { makeInitialData, normalizeData, readLocalData, STORAGE_KEY } from './appData.js';

export function useCloudState() {
  const [data, setData] = useState(readLocalData);
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(cloudConfigured);
  const [dataLoading, setDataLoading] = useState(cloudConfigured);
  const [syncStatus, setSyncStatus] = useState(cloudConfigured ? 'checking' : 'local');
  const [syncError, setSyncError] = useState('');
  const skipSaveRef = useRef(false);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* local storage is only a preview cache */ }
  }, [data]);

  useEffect(() => {
    if (!cloudConfigured) return undefined;
    let alive = true;
    supabase.auth.getSession().then(({ data: authData, error }) => {
      if (!alive) return;
      if (error) setSyncError(error.message);
      setSession(authData?.session || null);
      setAuthLoading(false);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setDataLoading(Boolean(nextSession));
      setSyncError('');
    });
    return () => { alive = false; authListener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!cloudConfigured || !session?.user?.id) {
      setDataLoading(false);
      return undefined;
    }
    let alive = true;
    const ownerId = session.user.id;
    setDataLoading(true);
    setSyncStatus('loading');
    const channel = supabase.channel(`app-state-${ownerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_state', filter: `owner_id=eq.${ownerId}` }, (payload) => {
        if (!alive || !payload.new?.data) return;
        skipSaveRef.current = true;
        setData(normalizeData(payload.new.data));
        setSyncStatus('synced');
      })
      .subscribe();

    async function load() {
      const { data: row, error } = await supabase.from('app_state').select('data').eq('owner_id', ownerId).maybeSingle();
      if (!alive) return;
      if (error) {
        setSyncError('No se pudo leer la base. Revisá el archivo database/schema.sql y las claves de conexión.');
        setSyncStatus('error');
        setDataLoading(false);
        return;
      }
      if (row?.data) {
        skipSaveRef.current = true;
        setData(normalizeData(row.data));
      } else {
        const initial = normalizeData(readLocalData() || makeInitialData());
        const { error: insertError } = await supabase.from('app_state').upsert({ owner_id: ownerId, data: initial, updated_at: new Date().toISOString() }, { onConflict: 'owner_id' });
        if (!alive) return;
        if (insertError) {
          setSyncError('No se pudo crear el registro en la base de datos.');
          setSyncStatus('error');
        } else {
          skipSaveRef.current = true;
          setData(initial);
          setSyncStatus('synced');
        }
      }
      setDataLoading(false);
    }
    load();
    return () => { alive = false; supabase.removeChannel(channel); };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!cloudConfigured || !session?.user?.id || dataLoading) return undefined;
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return undefined;
    }
    const ownerId = session.user.id;
    const timer = setTimeout(async () => {
      setSyncStatus('saving');
      const { error } = await supabase.from('app_state').upsert({ owner_id: ownerId, data, updated_at: new Date().toISOString() }, { onConflict: 'owner_id' });
      if (error) {
        setSyncError('No se pudo guardar en la nube. Revisá tu conexión.');
        setSyncStatus('error');
      } else {
        setSyncError('');
        setSyncStatus('synced');
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [data, session?.user?.id, dataLoading]);

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error?.message || '';
  }

  async function signUp(email, password) {
    const { data: result, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    return { error: error?.message || '', needsEmailConfirmation: !error && !result?.session };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setDataLoading(false);
    setSyncStatus('signed-out');
  }

  return { data, setData, session, authLoading, dataLoading, syncStatus, syncError, signIn, signUp, signOut, cloudConfigured };
}
