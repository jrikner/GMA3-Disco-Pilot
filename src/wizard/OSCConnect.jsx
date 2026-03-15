import React, { useState } from 'react'
import useStore from '../store/appState.js'
import * as oscClient from '../osc/client.js'
import styles from './Wizard.module.css'

export default function OSCConnect() {
  const { osc, updateOsc } = useStore()
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const connect = async () => {
    setTesting(true)
    setTestResult(null)
    const result = await oscClient.connect(osc.host, osc.port)
    if (result.success) {
      updateOsc({ connected: true, lastError: null })
      // Send a harmless test command
      const cmdResult = await oscClient.sendCmd('echo DiscoPilotConnected')
      setTestResult({ ok: true, msg: 'Connected successfully!' })
    } else {
      updateOsc({ connected: false, lastError: result.error })
      setTestResult({ ok: false, msg: result.error || 'Connection failed' })
    }
    setTesting(false)
  }

  return (
    <div>
      <h2 className={styles.stepTitle}>OSC Connection</h2>
      <p className={styles.stepDesc}>
        Connect the app to your GrandMA3 console via OSC over UDP.
        The console and this Mac must be on the same network.
      </p>

      {/* MA3 setup instructions */}
      <div className={styles.card}>
        <div className={styles.label}>How to enable OSC on GrandMA3</div>
        <ol style={{ fontSize: 13, color: '#aaa', lineHeight: 2, paddingLeft: 20, marginTop: 12 }}>
          <li>On the MA3 console, go to <strong style={{ color: '#e0e0e0' }}>Menu → Setup → Network</strong></li>
          <li>Open <strong style={{ color: '#e0e0e0' }}>OSC</strong> settings</li>
          <li>Enable OSC and set the <strong style={{ color: '#e0e0e0' }}>Input Port</strong> (default: 8000)</li>
          <li>Note the console's IP address from the same menu</li>
          <li>Optionally enable <strong style={{ color: '#e0e0e0' }}>OSC Output</strong> on a different port (8001) for feedback</li>
        </ol>
      </div>

      <div className={styles.card}>
        <div className={styles.row}>
          <div style={{ flex: 2 }}>
            <div className={styles.label}>MA3 Console IP Address</div>
            <input
              className={styles.input}
              placeholder="192.168.1.100"
              value={osc.host}
              onChange={e => updateOsc({ host: e.target.value })}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div className={styles.label}>OSC Port</div>
            <input
              type="number"
              className={styles.input}
              value={osc.port}
              onChange={e => updateOsc({ port: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className={styles.row} style={{ marginTop: 16 }}>
          <button
            className={styles.btnPrimary}
            onClick={connect}
            disabled={testing}
            style={{ minWidth: 140 }}
          >
            {testing ? 'Connecting…' : 'Test Connection'}
          </button>

          {testResult && (
            <div
              style={{
                flex: 1,
                padding: '10px 16px',
                background: testResult.ok ? '#052e16' : '#2d0a0a',
                border: `1px solid ${testResult.ok ? '#166534' : '#7f1d1d'}`,
                borderRadius: 8,
                fontSize: 13,
                color: testResult.ok ? '#86efac' : '#fca5a5',
              }}
            >
              {testResult.ok ? '✓ ' : '✗ '}{testResult.msg}
            </div>
          )}
        </div>
      </div>

      {osc.connected && (
        <div className={styles.card} style={{ borderColor: '#166534' }}>
          <div className={styles.label} style={{ color: '#22c55e' }}>Connection Active</div>
          <p style={{ fontSize: 13, color: '#86efac', marginTop: 8 }}>
            Connected to {osc.host}:{osc.port}. You can proceed to fader calibration.
          </p>
        </div>
      )}
    </div>
  )
}
