import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip
} from "recharts";

type Appointment = {
  id: number;
  patient_id: number;
  doctor_id: number;
  appointment_datetime: string;
  duration_minutes: number;
  reason: string | null;
  status: 'Scheduled' | 'Completed' | 'Cancelled' | 'No-Show';
  full_name: string;
  phone_number: string;
};

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.dir() === 'rtl';
  const locale = i18n.language || 'fr';

  // Auth and profile states
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [doctorProfile, setDoctorProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Stats numbers
  const [stats, setStats] = useState({
    todayAppointmentsCount: 0,
    totalPatients: 0,
    totalPrescriptions: 0,
    totalDocuments: 0
  });

  // Today's appointments list
  const [todayAppointments, setTodayAppointments] = useState<Appointment[]>([]);

  // Get today's YYYY-MM-DD date string
  const todayDateStr = useMemo(() => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }, []);

  // Fetch authentication and doctor profile
  useEffect(() => {
    (async () => {
      try {
        const auth = await (window as any).ipcRenderer.checkAuth();
        if (auth?.status === 'success' && auth.user?.id) {
          setCurrentUserId(auth.user.id);
        } else {
          window.location.hash = '/';
        }
      } catch (error) {
        console.error("Auth check failed:", error);
        window.location.hash = '/';
      }
    })();
  }, []);

  // Fetch doctor profile and then other dashboard data
  useEffect(() => {
    if (currentUserId !== null) {
      (async () => {
        try {
          const profileResult = await window.ipcRenderer.invoke('get-doctor-profile', currentUserId);
          if (profileResult.status === 'success' && profileResult.data) {
            setDoctorProfile(profileResult.data);
          }
        } catch (error) {
          console.error("Failed to load doctor profile:", error);
        }
      })();
    }
  }, [currentUserId]);

  // Load appointments and counts
  const loadDashboardData = async () => {
    if (!doctorProfile) return;
    setLoading(true);
    try {
      // 1. Fetch today's appointments
      const appts = await (window as any).ipcRenderer.getAppointmentsByDay(doctorProfile.id, todayDateStr);
      const apptsList = Array.isArray(appts) ? appts : [];
      setTodayAppointments(apptsList);

      // 2. Fetch count metrics
      const patientsCountResult = await window.ipcRenderer.invoke('count-patients');
      const prescriptionsCountResult = await window.ipcRenderer.invoke('count-prescriptions');
      const documentsResult = await window.ipcRenderer.invoke('get-all-documents');

      const totalPatients = typeof patientsCountResult === 'number' ? patientsCountResult : 0;
      const totalPrescriptions = typeof prescriptionsCountResult === 'number' ? prescriptionsCountResult : 0;
      const totalDocuments = Array.isArray(documentsResult) ? documentsResult.length : 0;

      setStats({
        todayAppointmentsCount: apptsList.length,
        totalPatients,
        totalPrescriptions,
        totalDocuments
      });
    } catch (error) {
      console.error("Failed to load dashboard statistics:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (doctorProfile) {
      loadDashboardData();
    }
  }, [doctorProfile, todayDateStr]);

  // Calculate status breakdown for the chart
  const distributionData = useMemo(() => {
    const counts = { Completed: 0, Scheduled: 0, Cancelled: 0, 'No-Show': 0 };
    todayAppointments.forEach(app => {
      if (app.status in counts) {
        counts[app.status]++;
      }
    });

    return [
      { name: t("appointments.status.completed", "Completed"), value: counts.Completed, color: "#10b981" },
      { name: t("appointments.status.scheduled", "Scheduled"), value: counts.Scheduled, color: "#1e2a56" },
      { name: t("appointments.status.cancelled", "Cancelled"), value: counts.Cancelled, color: "#e91e8c" },
      { name: t("appointments.status.no_show", "Absent"), value: counts['No-Show'], color: "#f59e0b" }
    ].filter(item => item.value > 0);
  }, [todayAppointments, t]);

  const distributionPieData = distributionData.length > 0 
    ? distributionData 
    : [{ name: t("statistics.status.none", "No Appointments"), value: 1, color: "#e5e7eb" }];

  return (
    <div className="space-y-6 text-[#1E2A56]">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#1E2A56]">{t('dashboard.title')}</h1>
        <p className="text-sm text-[#1E2A56]/50 mt-1">{t('dashboard.welcome')}</p>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <div className="w-10 h-10 border-4 border-[#e91e8c] border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm font-semibold text-[#1E2A56]/60">{t("appointments.loading", "Chargement...")}</span>
        </div>
      ) : (
        <>
          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { key: 'today_patients', value: stats.todayAppointmentsCount.toString(), accent: 'from-[#e91e8c] to-[#be185d]', icon: '📅', path: '/appointments' },
              { key: 'appointments', value: stats.totalPatients.toString(), accent: 'from-[#1e2a56] to-slate-800', icon: '🩺', path: '/patients' },
              { key: 'documents', value: stats.totalDocuments.toString(), accent: 'from-pink-dark to-[#e91e8c]', icon: '📄', path: '/documents' },
              { key: 'prescriptions', value: stats.totalPrescriptions.toString(), accent: 'from-slate-700 to-[#1e2a56]', icon: '💊', path: '/prescriptions' },
            ].map(card => (
              <Link
                key={card.key}
                to={card.path}
                className="relative overflow-hidden bg-white rounded-2xl p-5 shadow-[0_2px_12px_rgba(30,42,86,0.04)] hover:shadow-[0_8px_30px_rgba(30,42,86,0.08)] transition-all duration-300 group no-underline text-inherit block border border-white/20"
              >
                <div className={`absolute top-0 ${isRtl ? 'left-0 rounded-br-[40px]' : 'right-0 rounded-bl-[40px]'} w-20 h-20 bg-gradient-to-br ${card.accent} opacity-[0.07] group-hover:opacity-[0.12] transition-opacity duration-300`} />
                <div className="text-2xl mb-2">{card.icon}</div>
                <div className="text-3xl font-extrabold text-[#1E2A56] tracking-tight">{card.value}</div>
                <div className="text-xs text-gray-400 font-bold mt-1 uppercase tracking-wider">
                  {card.key === 'today_patients' ? t('dashboard.stats.today_patients', "Rendez-vous du jour") : t(`dashboard.stats.${card.key}`)}
                </div>
              </Link>
            ))}
          </div>

          {/* Today's Appointments & Distribution Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Today's Appointments List (Left column - 2 cols wide) */}
            <div className="lg:col-span-2 bg-white rounded-3xl p-6 border border-white/40 shadow-[0_4px_20px_rgba(30,42,86,0.03)] flex flex-col">
              <div className="flex items-center justify-between mb-4 border-b border-gray-50 pb-3">
                <h2 className="text-base font-bold text-[#1E2A56]">{t('dashboard.upcoming.title', "Planning d'aujourd'hui")}</h2>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                  {new Date().toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}
                </span>
              </div>

              {todayAppointments.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
                  <span className="text-3xl mb-2">📅</span>
                  <div className="text-sm font-semibold text-gray-400">{t('dashboard.upcoming.empty')}</div>
                  <Link
                    to="/appointments"
                    className="mt-4 px-5 py-2 rounded-xl bg-[#e91e8c] text-white text-xs font-bold shadow-md shadow-[#e91e8c]/25 hover:scale-[1.02] transition-transform no-underline"
                  >
                    {t('appointments.book_button', "Prendre un rendez-vous")}
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-gray-50 max-h-[380px] overflow-y-auto pr-1">
                  {todayAppointments.map((app) => {
                    const timeStr = app.appointment_datetime.split('T')[1]?.substring(0, 5) || '--:--';
                    
                    return (
                      <div key={app.id} className="flex items-center justify-between py-3.5 hover:bg-gray-50/50 rounded-xl px-2 transition-all">
                        <div className="flex items-center gap-4">
                          <span className="text-xs font-black text-gray-400 w-12">{timeStr}</span>
                          <div>
                            <span className="font-bold text-sm text-[#1E2A56] block">{app.full_name}</span>
                            {app.reason && (
                              <span className="text-[11px] text-gray-400 block truncate max-w-[250px] md:max-w-[400px]">
                                {app.reason}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Status Badge */}
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          app.status === 'Completed' ? 'bg-green-50 text-green-700 border border-green-200' :
                          app.status === 'Cancelled' ? 'bg-red-50 text-red-600 border border-red-200' :
                          app.status === 'No-Show' ? 'bg-amber-50 text-amber-600 border border-amber-200' :
                          'bg-[#e91e8c]/5 text-[#e91e8c] border border-[#e91e8c]/20'
                        }`}>
                          {app.status === 'Scheduled' ? t('appointments.status.scheduled') : app.status === 'Completed' ? t('appointments.status.completed') : app.status === 'Cancelled' ? t('appointments.status.cancelled') : t('appointments.status.no_show')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Distribution Pie Chart (Right Column - 1 col wide) */}
            <div className="bg-white rounded-3xl p-6 border border-white/40 shadow-[0_4px_20px_rgba(30,42,86,0.03)] flex flex-col justify-between">
              <div>
                <h3 className="text-base font-bold text-[#1E2A56] mb-2">
                  {t("statistics.charts.distribution_title", "Distribution du Jour")}
                </h3>
                <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider mb-4">
                  {t("statistics.charts.volume_subtitle", "Breakdown by Status")}
                </p>

                <div className="h-44 w-full flex items-center justify-center relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={distributionPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={68}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {distributionPieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#fff",
                          borderRadius: "12px",
                          border: "1px solid #f1f5f9",
                          fontSize: "12px",
                          fontWeight: 600
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>

                  {/* Inside Center Content */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-xl font-black text-[#1E2A56]">
                      {stats.todayAppointmentsCount}
                    </span>
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                      {t("statistics.charts.total", "Total RDV")}
                    </span>
                  </div>
                </div>
              </div>

              {/* Pie Breakdown Legend */}
              <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-gray-100">
                {distributionData.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <div className="flex flex-col">
                      <span className="text-[9px] font-bold text-gray-400 truncate max-w-[80px]">{item.name}</span>
                      <span className="text-xs font-black text-[#1E2A56]">{item.value}</span>
                    </div>
                  </div>
                ))}
                {distributionData.length === 0 && (
                  <span className="text-xs text-gray-400 text-center col-span-2 py-2">
                    {t("statistics.charts.no_data", "Aucune donnée")}
                  </span>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
