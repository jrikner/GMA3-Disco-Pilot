import React, { useEffect } from 'react'
import useStore from './store/appState.js'
import SetupWizard from './wizard/SetupWizard.jsx'
import Dashboard from './dashboard/Dashboard.jsx'
import Home from './Home.jsx'

export default function App() {
  const { screen } = useStore()

  if (screen === 'wizard') return <SetupWizard />
  if (screen === 'dashboard') return <Dashboard />
  return <Home />
}
