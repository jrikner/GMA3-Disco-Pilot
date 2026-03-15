import React from 'react'
import useStore from '../store/appState.js'
import FixtureGroupGrid from './FixtureGroupGrid.jsx'
import ColorPreferences from './ColorPreferences.jsx'
import GenreContext from './GenreContext.jsx'
import ExecutorMap from './ExecutorMap.jsx'
import PluginGenerator from './PluginGenerator.jsx'
import OSCConnect from './OSCConnect.jsx'
import Calibration from './Calibration.jsx'
import styles from './Wizard.module.css'

const STEPS = [
  { label: 'Fixture Groups',     component: FixtureGroupGrid },
  { label: 'Color Preferences',  component: ColorPreferences },
  { label: "Tonight's Context",  component: GenreContext },
  { label: 'Free Executor Spaces', component: ExecutorMap },
  { label: 'Generate MA3 Plugin', component: PluginGenerator },
  { label: 'OSC Connection',      component: OSCConnect },
  { label: 'Fader Calibration',   component: Calibration },
]

export default function SetupWizard() {
  const { wizardStep, setWizardStep, setScreen } = useStore()
  const Step = STEPS[wizardStep]?.component

  const prev = () => setWizardStep(Math.max(0, wizardStep - 1))
  const next = () => {
    if (wizardStep < STEPS.length - 1) {
      setWizardStep(wizardStep + 1)
    } else {
      setScreen('dashboard')
    }
  }

  return (
    <div className={styles.wizard}>
      {/* Header */}
      <div className={styles.header}>
        <h1>GMA3 Disco Pilot — Setup</h1>
        <div className={styles.stepIndicator}>
          {STEPS.map((s, i) => (
            <div
              key={i}
              className={`${styles.stepDot} ${i === wizardStep ? styles.active : ''} ${i < wizardStep ? styles.done : ''}`}
              title={s.label}
            />
          ))}
        </div>
        <div className={styles.stepLabel}>
          Step {wizardStep + 1} / {STEPS.length} — {STEPS[wizardStep]?.label}
        </div>
      </div>

      {/* Step content */}
      <div className={styles.stepContent}>
        {Step && <Step onNext={next} />}
      </div>

      {/* Navigation */}
      <div className={styles.nav}>
        <button className={styles.btnSecondary} onClick={() => setScreen('home')} disabled={wizardStep > 4}>
          Cancel
        </button>
        <div className={styles.navRight}>
          {wizardStep > 0 && (
            <button className={styles.btnSecondary} onClick={prev}>
              ← Back
            </button>
          )}
          <button className={styles.btnPrimary} onClick={next}>
            {wizardStep < STEPS.length - 1 ? 'Next →' : 'Go to Dashboard'}
          </button>
        </div>
      </div>
    </div>
  )
}
