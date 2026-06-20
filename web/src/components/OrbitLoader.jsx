// Branded "Ogilvy Orbit" loading animation — a coral planet orbiting a navy core.
export default function OrbitLoader({ size = 56, label, fullHeight = false }) {
  const s = size;
  const dot = Math.max(6, Math.round(s * 0.16));
  const core = Math.round(s * 0.26);
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 14, ...(fullHeight ? { minHeight: '50vh' } : { padding: '40px 0' }),
      }}
    >
      <style>{`
        @keyframes orbitSpin { to { transform: rotate(360deg); } }
        @keyframes orbitSpinRev { to { transform: rotate(-360deg); } }
        @keyframes orbitCore { 0%,100% { transform: translate(-50%,-50%) scale(1); } 50% { transform: translate(-50%,-50%) scale(.78); } }
        @keyframes orbitFade { 0%,100% { opacity: .35; } 50% { opacity: 1; } }
      `}</style>
      <div style={{ position: 'relative', width: s, height: s }}>
        {/* orbital rings */}
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid #E5E8ED' }} />
        <div style={{ position: 'absolute', inset: Math.round(s * 0.17), borderRadius: '50%', border: '1.5px dashed #C7D0DD', animation: 'orbitFade 1.6s ease-in-out infinite' }} />

        {/* navy core */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%', width: core, height: core,
          borderRadius: '50%', background: 'linear-gradient(135deg,#16243C,#0A1729)',
          boxShadow: '0 0 0 3px #fff, 0 2px 6px rgba(10,23,41,.4)',
          animation: 'orbitCore 1.6s ease-in-out infinite',
        }} />

        {/* coral planet on the outer ring */}
        <div style={{ position: 'absolute', inset: 0, animation: 'orbitSpin 1.1s linear infinite' }}>
          <div style={{
            position: 'absolute', top: -dot / 2 + 1, left: '50%', marginLeft: -dot / 2,
            width: dot, height: dot, borderRadius: '50%', background: '#E85D24',
            boxShadow: '0 0 8px rgba(232,93,36,.7)',
          }} />
        </div>

        {/* inner accent planet, counter-rotating */}
        <div style={{ position: 'absolute', inset: Math.round(s * 0.17), animation: 'orbitSpinRev 1.7s linear infinite' }}>
          <div style={{
            position: 'absolute', top: -Math.round(dot * 0.4), left: '50%', marginLeft: -Math.round(dot * 0.3),
            width: Math.round(dot * 0.6), height: Math.round(dot * 0.6), borderRadius: '50%', background: '#1F5BB5',
          }} />
        </div>
      </div>
      {label && <div style={{ fontSize: 13, fontWeight: 600, color: '#6B7790', letterSpacing: '.2px' }}>{label}</div>}
    </div>
  );
}
