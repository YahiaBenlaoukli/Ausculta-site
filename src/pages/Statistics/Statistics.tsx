import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell
} from "recharts";

type TopPatient = {
  id: number;
  full_name: string;
  phone_number: string | null;
  no_show_count: number;
};

type AppointmentStats = {
  total_completed: number;
  total_no_show: number;
  total_cancelled: number;
  total_scheduled: number;
  total_appointments: number;
  total_revenue: number;
};

type NoShowRateData = {
  total_no_show: number;
  total_appointments: number;
  no_show_rate: number;
  top_no_show_patients: TopPatient[];
};

type MonthlyVolume = {
  month: string;
  total_appointments: number;
  completed_appointments: number;
};

export default function Statistics() {
  const { t } = useTranslation();

  // Predefined ranges helper
  const getRangeDates = (rangeType: string) => {
    const today = new Date();
    let start = new Date();
    const yyyy = today.getFullYear();

    switch (rangeType) {
      case "month":
        // First day of current month
        start = new Date(yyyy, today.getMonth(), 1);
        break;
      case "quarter":
        // 3 months ago
        start = new Date();
        start.setMonth(today.getMonth() - 3);
        break;
      case "year":
        // First day of current year
        start = new Date(yyyy, 0, 1);
        break;
      case "all":
      default:
        // Jan 1st 2020
        start = new Date(2020, 0, 1);
        break;
    }

    const formatDate = (date: Date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    };

    return {
      startDate: formatDate(start),
      endDate: formatDate(today)
    };
  };

  const defaultDates = getRangeDates("year");

  // Date filters & config state
  const [activeRange, setActiveRange] = useState<string>("year");
  const [startDate, setStartDate] = useState<string>(defaultDates.startDate);
  const [endDate, setEndDate] = useState<string>(defaultDates.endDate);
  const [priceInput, setPriceInput] = useState<string>(localStorage.getItem('default_consultation_price') || "2000");
  const [loading, setLoading] = useState<boolean>(true);

  // Statistics state
  const [appointmentStats, setAppointmentStats] = useState<AppointmentStats>({
    total_completed: 0,
    total_no_show: 0,
    total_cancelled: 0,
    total_scheduled: 0,
    total_appointments: 0,
    total_revenue: 0
  });

  const [noShowRateData, setNoShowRateData] = useState<NoShowRateData>({
    total_no_show: 0,
    total_appointments: 0,
    no_show_rate: 0,
    top_no_show_patients: []
  });

  const [consultationVolume, setConsultationVolume] = useState<MonthlyVolume[]>([]);

  // Load all statistics from backend APIs
  const fetchStats = async () => {
    setLoading(true);
    try {
      const parsedPrice = parseFloat(priceInput) || 0;

      // Invoke Electron backend services
      const appStatsResult = await window.ipcRenderer.invoke(
        "get-appointment-statistics",
        startDate,
        endDate,
        parsedPrice
      );

      const noShowResult = await window.ipcRenderer.invoke(
        "get-noshow-rate",
        startDate,
        endDate
      );

      const volumeResult = await window.ipcRenderer.invoke(
        "get-consultation-volume",
        startDate,
        endDate
      );

      if (appStatsResult && !appStatsResult.status) {
        setAppointmentStats(appStatsResult);
      }
      if (noShowResult && !noShowResult.status) {
        setNoShowRateData(noShowResult);
      }
      if (Array.isArray(volumeResult)) {
        setConsultationVolume(volumeResult);
      }
    } catch (error) {
      console.error("Failed to load statistics:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [startDate, endDate, priceInput]);

  // Handle Quick Range Button Clicks
  const handleRangeChange = (range: string) => {
    setActiveRange(range);
    const dates = getRangeDates(range);
    setStartDate(dates.startDate);
    setEndDate(dates.endDate);
  };

  // Distribution chart data
  const distributionData = [
    { name: t("statistics.status.completed", "Completed"), value: appointmentStats.total_completed, color: "#10b981" }, // green
    { name: t("statistics.status.scheduled", "Scheduled"), value: appointmentStats.total_scheduled, color: "#1e2a56" }, // navy
    { name: t("statistics.status.cancelled", "Cancelled"), value: appointmentStats.total_cancelled, color: "#e91e8c" }, // pink
    { name: t("statistics.status.no_show", "No-Show"), value: appointmentStats.total_no_show, color: "#f59e0b" } // amber
  ].filter(item => item.value > 0);

  // Fallback if no distribution values
  const distributionPieData = distributionData.length > 0 
    ? distributionData 
    : [{ name: t("statistics.status.none", "No Data"), value: 1, color: "#e5e7eb" }];

  return (
    <div className="space-y-6 text-[#1E2A56]">
      {/* ── Page Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E2A56]">{t("statistics.title", "Statistiques & Analyses")}</h1>
          <p className="text-sm text-[#1E2A56]/50 mt-1">
            {t("statistics.welcome", "Visualisez l'activité médicale, le taux de présence et la performance financière.")}
          </p>
        </div>

        {/* Price & Date Selector Box */}
        <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-2xl border border-white/40 shadow-[0_2px_12px_rgba(30,42,86,0.04)]">
          {/* Price Config */}
          <div className="flex items-center gap-2 border-r border-[#1E2A56]/10 pr-3 mr-1">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t("statistics.filters.price", "Prix RDV")}:</span>
            <input
              type="number"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              className="w-20 px-2 py-1 bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold text-[#1E2A56] text-center focus:outline-none focus:border-[#e91e8c]"
            />
            <span className="text-xs font-bold text-gray-400">DA</span>
          </div>

          {/* Quick Select Buttons */}
          <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-xl">
            {[
              { id: "month", label: t("statistics.ranges.month", "Mois") },
              { id: "quarter", label: t("statistics.ranges.quarter", "Trimestre") },
              { id: "year", label: t("statistics.ranges.year", "Année") },
              { id: "all", label: t("statistics.ranges.all", "Tout") }
            ].map((btn) => (
              <button
                key={btn.id}
                onClick={() => handleRangeChange(btn.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeRange === btn.id
                    ? "bg-[#1E2A56] text-white shadow-sm"
                    : "text-[#1E2A56]/60 hover:text-[#1E2A56] hover:bg-gray-150"
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          {/* Custom Date Pickers */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setActiveRange("custom");
              }}
              className="px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold focus:outline-none focus:border-[#e91e8c]"
            />
            <span className="text-gray-300">/</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setActiveRange("custom");
              }}
              className="px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold focus:outline-none focus:border-[#e91e8c]"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <div className="w-10 h-10 border-4 border-[#e91e8c] border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm font-semibold text-[#1E2A56]/60">{t("statistics.loading", "Chargement des données...")}</span>
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── Key Metrics Cards (Glassmorphism layout like reference photo 1) ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Metric 1: Completed Appointments */}
            <div className="relative overflow-hidden bg-white rounded-3xl p-6 border border-white/40 shadow-[0_4px_20px_rgba(30,42,86,0.05)] hover:shadow-[0_8px_30px_rgba(30,42,86,0.1)] transition-all duration-300 group">
              <div className="absolute top-0 right-0 rounded-bl-[50px] w-24 h-24 bg-gradient-to-br from-[#10b981] to-teal-400 opacity-[0.06] group-hover:opacity-[0.12] transition-opacity duration-300" />
              <span className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-1">
                {t("statistics.metrics.completed", "Consultations")}
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-extrabold tracking-tight text-[#1E2A56]">
                  {appointmentStats.total_completed}
                </span>
                <span className="text-xs font-bold text-green-500 flex items-center gap-0.5">
                  ▲ {appointmentStats.total_appointments > 0 ? Math.round((appointmentStats.total_completed / appointmentStats.total_appointments) * 100) : 0}%
                </span>
              </div>
              {/* Card Illustration */}
              <div className="absolute bottom-4 right-5 text-green-500 opacity-20 group-hover:scale-110 transition-transform duration-300">
                <svg className="w-14 h-14" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z" />
                </svg>
              </div>
              <p className="text-[11px] text-gray-400 font-medium mt-3">
                {t("statistics.metrics.completed_sub", "Consultations terminées avec succès")}
              </p>
            </div>

            {/* Metric 2: Estimated Revenue */}
            <div className="relative overflow-hidden bg-white rounded-3xl p-6 border border-white/40 shadow-[0_4px_20px_rgba(30,42,86,0.05)] hover:shadow-[0_8px_30px_rgba(30,42,86,0.1)] transition-all duration-300 group">
              <div className="absolute top-0 right-0 rounded-bl-[50px] w-24 h-24 bg-gradient-to-br from-[#e91e8c] to-[#be185d] opacity-[0.06] group-hover:opacity-[0.12] transition-opacity duration-300" />
              <span className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-1">
                {t("statistics.metrics.revenue", "Revenus Estimés")}
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold tracking-tight text-[#1E2A56] truncate max-w-[85%]">
                  {appointmentStats.total_revenue.toLocaleString()}
                </span>
                <span className="text-sm font-extrabold text-[#e91e8c]">DA</span>
              </div>
              {/* Card Illustration */}
              <div className="absolute bottom-4 right-5 text-[#e91e8c] opacity-20 group-hover:scale-110 transition-transform duration-300">
                <svg className="w-14 h-14" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              </div>
              <p className="text-[11px] text-gray-400 font-medium mt-3">
                {t("statistics.metrics.revenue_sub", "Total estimé des honoraires")}
              </p>
            </div>

            {/* Metric 3: No-Show Rate */}
            <div className="relative overflow-hidden bg-white rounded-3xl p-6 border border-white/40 shadow-[0_4px_20px_rgba(30,42,86,0.05)] hover:shadow-[0_8px_30px_rgba(30,42,86,0.1)] transition-all duration-300 group">
              <div className="absolute top-0 right-0 rounded-bl-[50px] w-24 h-24 bg-gradient-to-br from-amber-500 to-orange-400 opacity-[0.06] group-hover:opacity-[0.12] transition-opacity duration-300" />
              <span className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-1">
                {t("statistics.metrics.noshow", "Taux d'Absence")}
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-extrabold tracking-tight text-[#1E2A56]">
                  {Math.round(noShowRateData.no_show_rate * 10) / 10}%
                </span>
                <span className={`text-xs font-bold flex items-center gap-0.5 ${noShowRateData.no_show_rate > 15 ? "text-red-500" : "text-amber-500"}`}>
                  ● {noShowRateData.total_no_show} {t("statistics.metrics.absents", "absents")}
                </span>
              </div>
              {/* Card Illustration */}
              <div className="absolute bottom-4 right-5 text-amber-500 opacity-20 group-hover:scale-110 transition-transform duration-300">
                <svg className="w-14 h-14" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 16.318A4.486 4.486 0 0 0 12.016 15a4.486 4.486 0 0 0-3.198 1.318M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z" />
                </svg>
              </div>
              <p className="text-[11px] text-gray-400 font-medium mt-3">
                {t("statistics.metrics.noshow_sub", "Ratio des patients n'ayant pas honoré le RDV")}
              </p>
            </div>

            {/* Metric 4: Cancelled Appointments */}
            <div className="relative overflow-hidden bg-white rounded-3xl p-6 border border-white/40 shadow-[0_4px_20px_rgba(30,42,86,0.05)] hover:shadow-[0_8px_30px_rgba(30,42,86,0.1)] transition-all duration-300 group">
              <div className="absolute top-0 right-0 rounded-bl-[50px] w-24 h-24 bg-gradient-to-br from-red-500 to-pink-400 opacity-[0.06] group-hover:opacity-[0.12] transition-opacity duration-300" />
              <span className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-1">
                {t("statistics.metrics.cancelled", "RDV Annulés")}
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-extrabold tracking-tight text-[#1E2A56]">
                  {appointmentStats.total_cancelled}
                </span>
                <span className="text-xs font-bold text-red-500 flex items-center gap-0.5">
                  ▼ {appointmentStats.total_appointments > 0 ? Math.round((appointmentStats.total_cancelled / appointmentStats.total_appointments) * 100) : 0}%
                </span>
              </div>
              {/* Card Illustration */}
              <div className="absolute bottom-4 right-5 text-red-500 opacity-20 group-hover:scale-110 transition-transform duration-300">
                <svg className="w-14 h-14" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
              </div>
              <p className="text-[11px] text-gray-400 font-medium mt-3">
                {t("statistics.metrics.cancelled_sub", "Rendez-vous annulés ou reportés")}
              </p>
            </div>
          </div>

          {/* ── Main Charts Row ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Consultation Volume (Line / Area chart) - 2 cols width */}
            <div className="lg:col-span-2 bg-white rounded-3xl p-6 border border-white/40 shadow-[0_4px_20px_rgba(30,42,86,0.03)] flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-bold text-[#1E2A56]">{t("statistics.charts.volume_title", "Volume des Consultations")}</h3>
                  <span className="text-xs font-semibold text-gray-400 tracking-wider">
                    {t("statistics.charts.volume_subtitle", "Évolution par mois")}
                  </span>
                </div>

                <div className="h-72 w-full mt-2">
                  {consultationVolume.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-gray-400 text-sm font-medium">
                      {t("statistics.charts.no_data", "Aucune donnée de consultation pour cette période.")}
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={consultationVolume}
                        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#1E2A56" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#1E2A56" stopOpacity={0.0} />
                          </linearGradient>
                          <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#e91e8c" stopOpacity={0.25} />
                            <stop offset="95%" stopColor="#e91e8c" stopOpacity={0.0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis
                          dataKey="month"
                          stroke="#94a3b8"
                          fontSize={10}
                          fontWeight={600}
                          tickLine={false}
                          axisLine={false}
                          dy={10}
                        />
                        <YAxis
                          stroke="#94a3b8"
                          fontSize={10}
                          fontWeight={600}
                          tickLine={false}
                          axisLine={false}
                          dx={-5}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "rgba(30, 42, 86, 0.95)",
                            borderRadius: "16px",
                            border: "none",
                            color: "#fff",
                            fontSize: "12px",
                            boxShadow: "0 10px 25px rgba(30, 42, 86, 0.15)"
                          }}
                          labelClassName="font-bold text-pink-400 mb-1"
                        />
                        <Area
                          type="monotone"
                          dataKey="total_appointments"
                          name={t("statistics.charts.legend_total", "Total RDV")}
                          stroke="#1E2A56"
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#colorTotal)"
                        />
                        <Area
                          type="monotone"
                          dataKey="completed_appointments"
                          name={t("statistics.charts.legend_completed", "Complétés")}
                          stroke="#e91e8c"
                          strokeWidth={2.5}
                          fillOpacity={1}
                          fill="url(#colorCompleted)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>

            {/* Appointment Distribution (Pie chart / Donut) */}
            <div className="bg-white rounded-3xl p-6 border border-white/40 shadow-[0_4px_20px_rgba(30,42,86,0.03)] flex flex-col justify-between">
              <div>
                <h3 className="text-base font-bold text-[#1E2A56] mb-4">
                  {t("statistics.charts.distribution_title", "Distribution des RDV")}
                </h3>

                <div className="h-60 w-full flex items-center justify-center relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={distributionPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={85}
                        paddingAngle={4}
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
                    <span className="text-2xl font-black text-[#1E2A56]">
                      {appointmentStats.total_appointments}
                    </span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      {t("statistics.charts.total", "Total RDV")}
                    </span>
                  </div>
                </div>
              </div>

              {/* Donut Legend */}
              <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-gray-100">
                {distributionData.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <div className="flex flex-col">
                      <span className="text-[10px] font-bold text-gray-400 truncate max-w-[100px]">{item.name}</span>
                      <span className="text-xs font-black text-[#1E2A56]">{item.value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Top Patients & No-Show Details ── */}
          <div className="grid grid-cols-1 gap-6">
            <div className="bg-white rounded-3xl p-6 border border-white/40 shadow-[0_4px_20px_rgba(30,42,86,0.03)]">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-[#1E2A56]">{t("statistics.table.top_absents_title", "Patients les Plus Absents")}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {t("statistics.table.top_absents_subtitle", "Patients ayant cumulé des absences (No-Show) sur la période.")}
                  </p>
                </div>
                <span className="px-3 py-1 bg-amber-50 border border-amber-250 text-amber-600 rounded-full text-xs font-bold uppercase tracking-wider">
                  {t("statistics.table.badge_alert", "A Suivre / Alert")}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">{t("statistics.table.patient", "Patient")}</th>
                      <th className="py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">{t("statistics.table.phone", "Téléphone")}</th>
                      <th className="py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider text-center">{t("statistics.table.no_show_count", "Absences")}</th>
                      <th className="py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider w-[35%]">{t("statistics.table.intensity", "Gravité")}</th>
                      <th className="py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider text-right">{t("statistics.table.status", "Statut")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {noShowRateData.top_no_show_patients.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-sm text-gray-400 font-medium">
                          {t("statistics.table.empty", "Aucun patient absent sur cette période. Félicitations !")}
                        </td>
                      </tr>
                    ) : (
                      noShowRateData.top_no_show_patients.map((patient) => {
                        // Max absences in the top list for scale visualization
                        const maxAbsences = Math.max(
                          ...noShowRateData.top_no_show_patients.map(p => p.no_show_count),
                          1
                        );
                        const progressPercent = Math.min((patient.no_show_count / maxAbsences) * 100, 100);

                        // Initials for avatar
                        const initials = patient.full_name
                          .split(" ")
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase();

                        return (
                          <tr key={patient.id} className="hover:bg-gray-50/50 transition-colors">
                            <td className="py-3.5">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-full bg-[#1E2A56]/5 text-[#1E2A56] font-bold text-xs flex items-center justify-center flex-shrink-0">
                                  {initials}
                                </div>
                                <span className="font-bold text-sm text-[#1E2A56]">{patient.full_name}</span>
                              </div>
                            </td>
                            <td className="py-3.5 text-sm text-gray-500 font-medium">{patient.phone_number || "—"}</td>
                            <td className="py-3.5 text-sm font-extrabold text-[#e91e8c] text-center">{patient.no_show_count}</td>
                            <td className="py-3.5">
                              <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-amber-400 to-[#e91e8c] rounded-full transition-all duration-500"
                                  style={{ width: `${progressPercent}%` }}
                                />
                              </div>
                            </td>
                            <td className="py-3.5 text-right">
                              <span className="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-red-50 text-red-600 border border-red-200 uppercase tracking-wide">
                                {patient.no_show_count >= 3 ? t("statistics.table.alert_critical", "Critique") : t("statistics.table.alert_warn", "Averti")}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
