import { useEffect, useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type { DoctorProfile } from "../../../types/doctor";
import TomorrowReminders from "../../components/Reminders/TomorrowReminders";
import BookingModal from "../../components/Appointments/BookingModal";
import { TIME_SLOTS, dateKey } from "../../components/Appointments/schedule";
// Recharts takes colours as props and inline data, so these cannot be classes.
import { PALETTE } from "../../../theme/palette";
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

/** 'HH:MM' out of the stored 'YYYY-MM-DDTHH:MM:SS'. */
function slotOf(appointment: Appointment) {
  return appointment.appointment_datetime.split('T')[1]?.substring(0, 5) || '--:--';
}

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const locale = i18n.language || 'fr';

  // Auth and profile states
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);
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

  // Booking straight from the dashboard planner.
  const [showBooking, setShowBooking] = useState(false);
  const [bookingSlot, setBookingSlot] = useState("11:00");
  const [successMessage, setSuccessMessage] = useState("");

  const today = useMemo(() => new Date(), []);
  const todayDateStr = useMemo(() => dateKey(today), [today]);

  // Fetch authentication and doctor profile
  useEffect(() => {
    (async () => {
      try {
        const auth = await window.ipcRenderer.checkAuth();
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
          // The practice's profile, not the signed-in user's: appointments and
          // consultations key off doctor_profile, and an assistant has none.
          const profileResult = await window.ipcRenderer.getPracticeDoctorProfile();
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
  const loadDashboardData = useCallback(async () => {
    if (!doctorProfile) return;
    setLoading(true);
    try {
      // 1. Fetch today's appointments
      const appts = await window.ipcRenderer.getAppointmentsByDay(doctorProfile.id, todayDateStr);
      const apptsList = Array.isArray(appts) ? (appts as Appointment[]) : [];
      setTodayAppointments(apptsList);

      // 2. Fetch count metrics
      const totalPatients = await window.ipcRenderer.countPatients();
      // countPrescriptions returns { status, data } — unwrap the count
      const prescriptionsCountResult = await window.ipcRenderer.countPrescriptions();
      const totalPrescriptions = typeof prescriptionsCountResult?.data === 'number' ? prescriptionsCountResult.data : 0;
      const documentsResult = await window.ipcRenderer.getAllDocuments();
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
  }, [doctorProfile, todayDateStr]);

  useEffect(() => {
    if (doctorProfile) {
      loadDashboardData();
    }
  }, [doctorProfile, loadDashboardData]);

  /* The planner grid: every consulting slot, plus any booking that does not
     land on one — the calendar page hides those, and a hidden appointment on
     the day's own summary would be worse than an off-grid row. */
  const plannerRows = useMemo(() => {
    const times = new Set<string>(TIME_SLOTS);
    todayAppointments.forEach(a => times.add(slotOf(a)));
    return [...times].sort().map(time => ({
      time,
      appointment: todayAppointments.find(a => slotOf(a) === time),
    }));
  }, [todayAppointments]);

  const openBooking = (slot: string) => {
    setBookingSlot(slot);
    setShowBooking(true);
  };

  const handleBooked = () => {
    setSuccessMessage(t('appointments.success_message'));
    setTimeout(() => setSuccessMessage(""), 3000);
    loadDashboardData();
  };

  const handleUpdateStatus = async (id: number, status: string) => {
    try {
      const result = await window.ipcRenderer.updateAppointment(id, status);
      if (result.status === "success") loadDashboardData();
    } catch (error) {
      console.error("Failed to update status:", error);
    }
  };

  const handleDeleteAppointment = async (id: number) => {
    if (!confirm(t('appointments.confirm_delete'))) return;
    try {
      const result = await window.ipcRenderer.deleteAppointment(id);
      if (result.status === "success") loadDashboardData();
    } catch (error) {
      console.error("Failed to delete appointment:", error);
    }
  };

  // Same handoff the calendar uses: the consultation page opens the visit
  // record linked to this booking and completes it when the doctor is done.
  const handleStartConsultation = async (appointment: Appointment) => {
    try {
      const patient = await window.ipcRenderer.getPatientById(appointment.patient_id);
      if (!patient) return;
      navigate('/consultation', { state: { patient, appointmentId: appointment.id } });
    } catch (error) {
      console.error("Failed to start consultation:", error);
    }
  };

  const statusLabel = (status: Appointment['status']) =>
    status === 'Scheduled' ? t('appointments.status.scheduled')
      : status === 'Completed' ? t('appointments.status.completed')
        : status === 'Cancelled' ? t('appointments.status.cancelled')
          : t('appointments.status.no_show');

  // Calculate status breakdown for the chart
  const distributionData = useMemo(() => {
    const counts = { Completed: 0, Scheduled: 0, Cancelled: 0, 'No-Show': 0 };
    todayAppointments.forEach(app => {
      if (app.status in counts) {
        counts[app.status]++;
      }
    });

    return [
      { name: t("appointments.status.completed"), value: counts.Completed, color: "#10b981" },
      { name: t("appointments.status.scheduled"), value: counts.Scheduled, color: PALETTE.navy },
      { name: t("appointments.status.cancelled"), value: counts.Cancelled, color: PALETTE.pink },
      { name: t("appointments.status.no_show"), value: counts['No-Show'], color: "#f59e0b" }
    ].filter(item => item.value > 0);
  }, [todayAppointments, t]);

  const distributionPieData = distributionData.length > 0
    ? distributionData
    : [{ name: t("dashboard.chart.no_data"), value: 1, color: "#e5e7eb" }];

  // Determine which required doctor profile fields are missing
  const missingProfileFields = useMemo(() => {
    if (!doctorProfile) return [];
    const missing: string[] = [];
    if (!doctorProfile.email?.trim()) missing.push(t('dashboard.profile_notice.email'));
    if (!doctorProfile.phoneNumber?.trim()) missing.push(t('dashboard.profile_notice.phone'));
    if (!doctorProfile.address?.trim()) missing.push(t('dashboard.profile_notice.address'));
    return missing;
  }, [doctorProfile, t]);

  return (
    <div className="space-y-7 text-navy">
      {/* Page Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-navy">{t('dashboard.title')}</h1>
          <p className="text-sm text-navy/50 mt-1.5">{t('dashboard.welcome')}</p>
        </div>
        {/* The one action that has no calendar entry to start from. */}
        <Link
          to="/consultation"
          className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-pink hover:bg-pink-dark text-white text-sm font-bold shadow-lg shadow-pink/20 transition-colors no-underline"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" />
            <path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4" />
            <circle cx="20" cy="10" r="2" />
          </svg>
          {t('dashboard.walk_in_action')}
        </Link>
      </div>

      {/* Incomplete Profile Notice */}
      {missingProfileFields.length > 0 && (
        <div className="flex items-center justify-between gap-4 flex-wrap rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
            </span>
            <div className="min-w-0">
              <div className="text-sm font-bold text-amber-800">{t('dashboard.profile_notice.title')}</div>
              <div className="text-xs text-amber-700/80 font-medium truncate">
                {t('dashboard.profile_notice.missing_prefix')}{missingProfileFields.join(', ')}
              </div>
            </div>
          </div>
          <Link
            to="/settings"
            className="flex-shrink-0 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold shadow-sm transition-colors no-underline"
          >
            {t('dashboard.profile_notice.action')}
          </Link>
        </div>
      )}

      {successMessage && (
        <div className="p-3.5 text-center bg-green-50 text-green-700 font-semibold rounded-2xl border border-green-200 animate-fade-in">
          {successMessage}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <div className="w-10 h-10 border-4 border-pink border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm font-semibold text-navy/60">{t("appointments.loading")}</span>
        </div>
      ) : (
        <>
          {/* Stats Cards */}
          {(() => {
            const completedToday = todayAppointments.filter(a => a.status === 'Completed').length;
            const cancelledOrAbsent = todayAppointments.filter(a => a.status === 'Cancelled' || a.status === 'No-Show').length;
            const cards = [
              {
                label: t('dashboard.stats.total_patients', 'Total Patients'),
                value: stats.totalPatients,
                subtitle: t('dashboard.stats.total_patients_sub', 'Patients enregistrés'),
                path: '/patients',
                highlighted: true,
              },
              {
                label: t('dashboard.stats.today_appointments', "Rendez-vous du jour"),
                value: stats.todayAppointmentsCount,
                subtitle: t('dashboard.stats.today_appointments_sub', 'Planifiés aujourd\'hui'),
                path: '/appointments',
                highlighted: false,
              },
              {
                label: t('dashboard.stats.completed_today', 'Consultations terminées'),
                value: completedToday,
                subtitle: t('dashboard.stats.completed_today_sub', 'Terminées avec succès'),
                path: '/appointments',
                highlighted: false,
              },
              {
                label: t('dashboard.stats.cancelled_absent', 'Annulés / Absents'),
                value: cancelledOrAbsent,
                subtitle: t('dashboard.stats.cancelled_absent_sub', 'Annulés ou non présentés'),
                path: '/appointments',
                highlighted: false,
              },
            ];

            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {cards.map((card, idx) => (
                  <Link
                    key={idx}
                    to={card.path}
                    className={`relative overflow-hidden rounded-3xl p-7 transition-all duration-300 group no-underline block border ${
                      card.highlighted
                        ? 'bg-gradient-to-br from-navy to-navy-light border-navy/20 shadow-[0_4px_20px_rgba(30,42,86,0.18)] hover:shadow-[0_8px_30px_rgba(30,42,86,0.25)]'
                        : 'bg-white border-white/20 shadow-[0_2px_12px_rgba(30,42,86,0.04)] hover:shadow-[0_8px_30px_rgba(30,42,86,0.08)]'
                    }`}
                  >
                    {/* Top row: label + arrow icon */}
                    <div className="flex items-center justify-between mb-6">
                      <span className={`text-xs font-bold uppercase tracking-wider ${
                        card.highlighted ? 'text-white/70' : 'text-gray-400'
                      }`}>
                        {card.label}
                      </span>
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                        card.highlighted
                          ? 'bg-white/10 text-white/60 group-hover:bg-white/20 group-hover:text-white'
                          : 'bg-gray-50 text-gray-400 group-hover:bg-pink/10 group-hover:text-pink'
                      }`}>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path d="M7 17L17 7M17 7H7M17 7v10" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </div>

                    {/* Big number */}
                    <div className={`text-5xl font-extrabold tracking-tight ${
                      card.highlighted ? 'text-white' : 'text-navy'
                    }`}>
                      {card.value}
                    </div>

                    {/* Subtitle */}
                    <div className={`text-xs font-semibold mt-3 flex items-center gap-1.5 ${
                      card.highlighted ? 'text-pink/80' : 'text-pink/60'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        card.highlighted ? 'bg-pink' : 'bg-pink/50'
                      }`} />
                      {card.subtitle}
                    </div>
                  </Link>
                ))}
              </div>
            );
          })()}

          {/* Tomorrow's WhatsApp reminders. Above today's schedule because it is
              the one thing on this page that expires: tomorrow's reminders are
              only useful while it is still today. */}
          {doctorProfile && <TomorrowReminders doctor={doctorProfile} />}

          {/* Today's Appointments & Distribution Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            {/* Today's planner — the calendar page's day view, compacted, and
                bookable in place so a call during a consultation does not cost
                a page change. */}
            <div className="lg:col-span-2 bg-white rounded-3xl p-7 border border-white/40 shadow-[0_4px_20px_rgba(30,42,86,0.03)] flex flex-col">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-5 border-b border-gray-100 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-navy">{t('dashboard.upcoming.title')}</h2>
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider capitalize">
                    {today.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    to="/appointments"
                    className="px-4 py-2 rounded-xl border border-gray-200 text-navy/60 hover:text-navy hover:bg-gray-50 text-xs font-bold transition-colors no-underline"
                  >
                    {t('dashboard.upcoming.view_all')}
                  </Link>
                  <button
                    onClick={() => openBooking("11:00")}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-pink hover:bg-pink-dark text-white text-xs font-bold shadow-md shadow-pink/20 transition-colors cursor-pointer border-none"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    {t('appointments.book_button')}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 max-h-[560px] overflow-y-auto pr-1.5">
                {plannerRows.map(({ time, appointment }) => {
                  if (!appointment) {
                    return (
                      <button
                        key={time}
                        onClick={() => openBooking(time)}
                        className="w-full group flex items-center gap-3 py-2 px-3.5 rounded-xl bg-white border border-gray-100 text-gray-400 hover:border-pink/40 hover:bg-pink/[0.03] hover:text-pink transition-all cursor-pointer"
                      >
                        <span className="text-xs font-black tracking-wider w-11 text-left">{time}</span>
                        <span className="flex-1 text-left text-[11px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                          {t('appointments.book_button')}
                        </span>
                        <svg className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      </button>
                    );
                  }

                  return (
                    <div
                      key={time}
                      className="relative flex flex-wrap items-center justify-between gap-2 py-2.5 pl-5 pr-3 rounded-xl bg-gray-50/70 border border-gray-200/70 overflow-hidden"
                    >
                      {/* Status side indicator */}
                      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${
                        appointment.status === 'Completed' ? 'bg-green-500' :
                        appointment.status === 'Cancelled' ? 'bg-red-400' :
                        appointment.status === 'No-Show' ? 'bg-amber-400' : 'bg-navy'
                      }`} />

                      <div className="flex items-center gap-3.5 min-w-0">
                        <span className="text-xs font-black text-gray-400 w-11 flex-shrink-0">{time}</span>
                        <div className="min-w-0">
                          <span className="font-bold text-sm text-navy block truncate">{appointment.full_name}</span>
                          {appointment.reason && (
                            <span className="text-[11px] text-gray-400 block truncate max-w-[240px]">{appointment.reason}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          appointment.status === 'Completed' ? 'bg-green-50 text-green-700 border border-green-200' :
                          appointment.status === 'Cancelled' ? 'bg-red-50 text-red-600 border border-red-200' :
                          appointment.status === 'No-Show' ? 'bg-amber-50 text-amber-600 border border-amber-200' :
                          'bg-pink/5 text-pink border border-pink/20'
                        }`}>
                          {statusLabel(appointment.status)}
                        </span>

                        {appointment.status === 'Scheduled' && (
                          <button
                            onClick={() => handleStartConsultation(appointment)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-pink/10 text-pink hover:bg-pink hover:text-white text-[11px] font-bold transition-colors cursor-pointer border-none"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" />
                              <path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4" />
                              <circle cx="20" cy="10" r="2" />
                            </svg>
                            {t('appointments.start_consultation')}
                          </button>
                        )}

                        <div className="flex items-center gap-0.5 bg-white border border-gray-100 rounded-full p-0.5">
                          {appointment.status === 'Scheduled' && (
                            <button
                              onClick={() => handleUpdateStatus(appointment.id, 'Completed')}
                              title={t('appointments.actions.complete')}
                              className="p-1.5 rounded-full hover:bg-green-50 text-green-600 cursor-pointer transition-all bg-transparent border-none"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </button>
                          )}
                          {appointment.status !== 'Cancelled' && (
                            <button
                              onClick={() => handleUpdateStatus(appointment.id, 'Cancelled')}
                              title={t('appointments.actions.cancel')}
                              className="p-1.5 rounded-full hover:bg-red-50 text-red-500 cursor-pointer transition-all bg-transparent border-none"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteAppointment(appointment.id)}
                            title={t('appointments.actions.delete')}
                            className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-red-500 cursor-pointer transition-all bg-transparent border-none"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Distribution Pie Chart (Right Column - 1 col wide) */}
            <div className="bg-white rounded-3xl p-7 border border-white/40 shadow-[0_4px_20px_rgba(30,42,86,0.03)] flex flex-col justify-between">
              <div>
                <h3 className="text-lg font-bold text-navy mb-2">
                  {t("dashboard.chart.distribution_title")}
                </h3>
                <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider mb-5">
                  {t("dashboard.chart.breakdown_subtitle")}
                </p>

                <div className="h-56 w-full flex items-center justify-center relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={distributionPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={62}
                        outerRadius={86}
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
                    <span className="text-3xl font-black text-navy">
                      {stats.todayAppointmentsCount}
                    </span>
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                      {t("dashboard.chart.total")}
                    </span>
                  </div>
                </div>
              </div>

              {/* Pie Breakdown Legend */}
              <div className="grid grid-cols-2 gap-3 mt-6 pt-4 border-t border-gray-100">
                {distributionData.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="text-[9px] font-bold text-gray-400 truncate">{item.name}</span>
                      <span className="text-sm font-black text-navy">{item.value}</span>
                    </div>
                  </div>
                ))}
                {distributionData.length === 0 && (
                  <span className="text-xs text-gray-400 text-center col-span-2 py-2">
                    {t("dashboard.chart.no_data")}
                  </span>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <BookingModal
        open={showBooking}
        date={today}
        doctorId={doctorProfile?.id ?? null}
        initialTime={bookingSlot}
        onClose={() => setShowBooking(false)}
        onBooked={handleBooked}
      />
    </div>
  );
}
