export default function Dashboard() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-navy">Tableau de bord</h1>
        <p className="text-sm text-navy/50 mt-1">Bienvenue, Dr. Martin — voici un aperçu de votre journée.</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {[
          { label: 'Patients du jour', value: '8', accent: 'from-pink to-pink-light', icon: '🩺' },
          { label: 'Rendez-vous', value: '12', accent: 'from-navy to-navy-light', icon: '📅' },
          { label: 'Documents', value: '34', accent: 'from-pink-dark to-pink', icon: '📄' },
          { label: 'Ordonnances', value: '6', accent: 'from-navy-light to-navy', icon: '💊' },
        ].map(card => (
          <div
            key={card.label}
            className="relative overflow-hidden bg-white rounded-2xl p-5 shadow-[0_2px_12px_rgba(30,42,86,0.06)] hover:shadow-[0_8px_30px_rgba(30,42,86,0.1)] transition-shadow duration-300 group"
          >
            <div className={`absolute top-0 right-0 w-20 h-20 bg-gradient-to-br ${card.accent} opacity-[0.07] rounded-bl-[40px] group-hover:opacity-[0.12] transition-opacity duration-300`} />
            <div className="text-2xl mb-2">{card.icon}</div>
            <div className="text-3xl font-bold text-navy">{card.value}</div>
            <div className="text-xs text-navy/45 font-medium mt-1">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Placeholder content */}
      <div className="bg-white rounded-2xl p-6 shadow-[0_2px_12px_rgba(30,42,86,0.06)]">
        <h2 className="text-lg font-semibold text-navy mb-3">Rendez-vous à venir</h2>
        <div className="text-sm text-navy/40">Le calendrier de vos prochains rendez-vous apparaîtra ici.</div>
      </div>
    </div>
  )
}
