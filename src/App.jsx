import React, { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Catalogos from './Catalogos.jsx'

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [msg, setMsg] = useState('')
  const [view, setView] = useState('panel') // panel | catalogos

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
   
