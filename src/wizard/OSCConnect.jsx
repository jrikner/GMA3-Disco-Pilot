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

    if (!result.success) {
      updateOsc({ connected: false, socketReady: false, lastError: result.error || 'Connection failed' })
      setTestResult({ ok: false, msg: result.error || 'Connection failed' })
      setTesting(false)
      return
    }

    const cmdResult = await oscClient.sendCmd('echo DiscoPilotConnected')
    const socketReady = result.socketReady && cmdResult.success
    const verified = socketReady && result.verified

    updateOsc({
      connected: verified,
      socketReady,
      lastError: socketReady ? null : (cmdResult.error || result.error || 'Unable to open OSC socket'),
    })

    if (!socketReady) {
      setTestResult({ ok: false, msg: cmdResult.error || result.error || 'Unable to send OSC command' })
    } else if (verified) {
      setTestResult({ ok: true, msg: 'OSC socket opened and the console host responded.' })
    } else {
      setTestResult({
        ok: 'warning',
        msg: result.warning || 'OSC socket opened, but the console could not be verified yet.',
      })
    }

    setTesting(false)
  }

  const feedbackStyle = testResult?.ok === true
    ? { background: '#052e16', border: '1px solid #166534', color: '#86efac' }
    : testResult?.ok === 'warning'
      ? { background: '#1c1917', border: '1px solid #a16207', color: '#fcd34d' }
      : { background: '#2d0a0a', border: '1px solid #7f1d1d', color: '#fca5a5' }

  return (
    <div>
      <h2 className={styles.stepTitle}>OSC Connection</h2>
      <p className={styles.stepDesc}>
        Connect the app to your GrandMA3 console via OSC over UDP.
        The console and this Mac must be on the same network.
      </p>

      <div className={styles.card}>
        <div className={styles.label}>How to enable OSC on GrandMA3</div>
        <ol style={{ fontSize: 13, color: '#aaa', lineHeight: 2, paddingLeft: 20, marginTop: 12 }}>
          <li>On the MA3 console, go to <strong style={{ color: '#e0e0e0' }}>Menu → Setup → Network</strong></li>
          <li>Open <strong style={{ color: '#e0e0e0' }}>OSC</strong> settings</li>
          <li>Enable OSC and set the <strong style={{ color: '#e0e0e0' }}>Input Port</strong> (default: 8000)</li>
          <li>Note the console&apos;s IP address from the same menu</li>
          <li>Enable <strong style={{ color: '#e0e0e0' }}>OSC Output</strong> on a different port (usually 8001) if you want the dashboard to show verified feedback</li>
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
            {testing ? 'Testing…' : 'Test Connection'}
          </button>

          {testResult && (
            <div
              style={{
                flex: 1,
                padding: '10px 16px',
                borderRadius: 8,
                fontSize: 13,
                ...feedbackStyle,
              }}
            >
              {testResult.ok === true ? '✓ ' : testResult.ok === 'warning' ? '• ' : '✗ '}
              {testResult.msg}
            </div>
          )}
        </div>
      </div>

      {osc.socketReady && (
        <div className={styles.card} style={{ borderColor: osc.connected ? '#166534' : '#a16207' }}>
          <div className={styles.label} style={{ color: osc.connected ? '#22c55e' : '#f59e0b' }}>
            {osc.connected ? 'Connection Verified' : 'OSC Socket Ready'}
          </div>
          <p style={{ fontSize: 13, color: osc.connected ? '#86efac' : '#fcd34d', marginTop: 8 }}>
            {osc.connected
              ? `Connected to ${osc.host}:${osc.port}. Feedback from the console can now light the dashboard green.`
              : `Commands can be sent to ${osc.host}:${osc.port}, but the console has not confirmed the connection yet.`}
          </p>
        </div>
      )}
    </div>
  )
}
