import { useEffect, useRef, useState } from 'react';
import { cloudConfigured, supabase } from './supabaseClient.js';
import { makeInitialData, normalizeData, readLocalData, STORAGE_KEY } from './appData.js';

export function useCloudState() {
  const [data, setData] = useState(readLocalData);
  const [session, setSession] = useState(null);
  const [membership, setMembership] = useState(null);
  const [authLoading, setAuthLoading] = useState(cloudConfigured);
  const [membershipLoading, setMembershipLoading] = useState(cloudConfigured);
  const [membershipError, setMembershipError] = useState('');
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
      setMembershipError('');
      setSyncError('');
    });
    return () => { alive = false; authListener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!cloudConfigured || !session?.user?.id) {
      setMembership(null);
      setMembershipError('');
      setMembershipLoading(false);
      setDataLoading(false);
      return undefined;
    }
    let alive = true;
    setMembershipLoading(true);
    setMembershipError('');
    supabase.from('team_memberships')
      .select('user_id, owner_id, username, email, display_name, role')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data: row, error }) => {
        if (!alive) return;
        setMembership(row || null);
        if (error) setMembershipError('No se pudo validar el acceso. Ejecutá la versión actualizada de database/schema.sql en Supabase.');
        else if (!row) setMembershipError('ACCOUNT_NOT_AUTHORIZED');
        setMembershipLoading(false);
      });
    return () => { alive = false; };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!cloudConfigured || !session?.user?.id || membershipLoading) return undefined;
    if (!membership?.owner_id) {
      setDataLoading(false);
      setSyncStatus(membershipError ? 'error' : 'signed-out');
      return undefined;
    }

    let alive = true;
    const ownerId = membership.owner_id;
    setDataLoading(true);
    setSyncStatus('loading');
    const channel = supabase.channel(`app-state-${ownerId}-${session.user.id}`)
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
        setSyncError('No se pudo leer la base. Revisá las políticas de database/schema.sql.');
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
          setSyncError('No se pudo crear el registro de la cancha. Revisá los permisos del usuario en Supabase.');
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
  }, [session?.user?.id, membership?.owner_id, membershipLoading, membershipError]);

  useEffect(() => {
    if (!cloudConfigured || !session?.user?.id || !membership?.owner_id || dataLoading) return undefined;
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return undefined;
    }
    const ownerId = membership.owner_id;
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
  }, [data, session?.user?.id, membership?.owner_id, dataLoading]);

  async function signIn(identifier, password) {
    if (identifier.includes('@')) {
      const { error } = await supabase.auth.signInWithPassword({ email: identifier.toLowerCase(), password });
      return error ? 'INVALID_CREDENTIALS' : '';
    }
    const { data: result, error } = await supabase.functions.invoke('team-login', { body: { username: identifier.toLowerCase(), password } });
    if (error || !result?.session?.access_token || !result?.session?.refresh_token) return 'INVALID_CREDENTIALS';
    const { error: sessionError } = await supabase.auth.setSession({ access_token: result.session.access_token, refresh_token: result.session.refresh_token });
    return sessionError ? 'INVALID_CREDENTIALS' : '';
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setMembership(null);
    setDataLoading(false);
    setSyncStatus('signed-out');
  }

  return { data, setData, session, membership, membershipLoading, membershipError, authLoading, dataLoading, syncStatus, syncError, signIn, signOut, cloudConfigured };
}
