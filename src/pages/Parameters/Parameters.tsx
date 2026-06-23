import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface DoctorProfile {
  id: number;
  userId: number;
  fullName: string;
  email: string;
  phoneNumber: string;
  address: string;
  speciality: string;
  hasCompletedProfile: boolean;
  pdfPath?: string;
}

export default function Parameters() {
  const { t } = useTranslation();

  // Tab State
  const [activeTab, setActiveTab] = useState<"profile" | "consultation" | "security" | "data">("profile");

  // User Session & Doctor Profile States
  const [currentUser, setCurrentUser] = useState<{ id: number; fullName: string; role: string } | null>(null);
  const [profile, setProfile] = useState<DoctorProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  // Form Fields
  const [fullName, setFullName] = useState("");
  const [speciality, setSpeciality] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");

  // Consultation Preferences
  const [defaultPrice, setDefaultPrice] = useState("2000");
  const [defaultDuration, setDefaultDuration] = useState("30");

  // Alerts
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Database Reset Input
  const [confirmResetText, setConfirmResetText] = useState("");
  const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);

  // Fetch initial authentication and doctor profile
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const auth = await (window as any).ipcRenderer.checkAuth();
        if (auth?.status === "success" && auth.user?.id) {
          setCurrentUser(auth.user);
          const profileResult = await (window as any).ipcRenderer.getDoctorProfile(auth.user.id);
          if (profileResult.status === "success" && profileResult.data) {
            const p = profileResult.data;
            setProfile(p);
            setFullName(p.fullName || "");
            setSpeciality(p.speciality || "");
            setPhone(p.phoneNumber || "");
            setEmail(p.email || "");
            setAddress(p.address || "");
          }
        } else {
          window.location.hash = "/";
        }
      } catch (error) {
        console.error("Failed to load settings data:", error);
      } finally {
        setLoading(false);
      }
    })();

    // Load LocalStorage Consultation Settings
    setDefaultPrice(localStorage.getItem("default_consultation_price") || "2000");
    setDefaultDuration(localStorage.getItem("default_consultation_duration") || "30");
  }, []);

  const triggerToast = (type: "success" | "error", msg: string) => {
    if (type === "success") {
      setSuccessMsg(msg);
      setTimeout(() => setSuccessMsg(""), 3500);
    } else {
      setErrorMsg(msg);
      setTimeout(() => setErrorMsg(""), 3500);
    }
  };

  // Profile Save
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setSaving(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const result = await (window as any).ipcRenderer.updateDoctorProfile(
        currentUser.id,
        fullName,
        speciality,
        phone,
        address,
        email
      );

      if (result.status === "success" && result.data) {
        setProfile(result.data);
        triggerToast("success", t("settings.profile.success"));
      } else {
        triggerToast("error", result.message || t("settings.profile.error"));
      }
    } catch (err) {
      console.error(err);
      triggerToast("error", t("settings.profile.error"));
    } finally {
      setSaving(false);
    }
  };

  // Consultation Settings Save
  const handleSaveConsultation = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem("default_consultation_price", defaultPrice);
    localStorage.setItem("default_consultation_duration", defaultDuration);
    triggerToast("success", t("settings.consultation.success"));
  };

  // Sign out
  const handleLogout = async () => {
    if (window.confirm(t("settings.security.logout_confirm"))) {
      try {
        await (window as any).ipcRenderer.logout();
        window.location.hash = "/";
      } catch (err) {
        console.error("Logout failed:", err);
      }
    }
  };

  // Export Patients as JSON
  const handleExportJSON = async () => {
    try {
      const patients = await (window as any).ipcRenderer.getAllPatients();
      const blob = new Blob([JSON.stringify(patients, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `patients_export_${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      triggerToast("success", t("settings.data.export_success"));
    } catch (err) {
      console.error(err);
      triggerToast("error", t("settings.data.export_error"));
    }
  };

  // Export Patients as CSV
  const handleExportCSV = async () => {
    try {
      const patients = await (window as any).ipcRenderer.getAllPatients();
      const headers = ["ID", "Nom Complet", "Date de Naissance", "Adresse", "Téléphone", "N Secu", "Gr Sanguin", "Date Creation"];
      const csvRows = [headers.join(",")];

      patients.forEach((p: any) => {
        csvRows.push([
          p.id,
          `"${(p.fullName || "").replace(/"/g, '""')}"`,
          `"${(p.dateOfBirth || "").replace(/"/g, '""')}"`,
          `"${(p.address || "").replace(/"/g, '""')}"`,
          `"${(p.phoneNumber || "").replace(/"/g, '""')}"`,
          `"${(p.ssn || "").replace(/"/g, '""')}"`,
          `"${(p.bloodType || "").replace(/"/g, '""')}"`,
          `"${(p.createdAt || "").replace(/"/g, '""')}"`
        ].join(","));
      });

      const csvContent = "\uFEFF" + csvRows.join("\n"); // Adding BOM for UTF-8 Excel support
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `patients_export_${Date.now()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      triggerToast("success", t("settings.data.export_success"));
    } catch (err) {
      console.error(err);
      triggerToast("error", t("settings.data.export_error"));
    }
  };

  // Reset Database
  const handleWipeDatabase = async () => {
    if (confirmResetText !== "RESET") {
      triggerToast("error", t("settings.data.reset_error"));
      return;
    }

    try {
      const result = await (window as any).ipcRenderer.resetDatabase();
      if (result.status === "success") {
        triggerToast("success", t("settings.data.reset_success"));
        setShowResetConfirmModal(false);
        setConfirmResetText("");
      } else {
        triggerToast("error", result.message || t("settings.data.reset_error"));
      }
    } catch (err) {
      console.error(err);
      triggerToast("error", t("settings.data.reset_error"));
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <div className="w-10 h-10 border-4 border-[#e91e8c] border-t-transparent rounded-full animate-spin"></div>
        <span className="text-sm font-semibold text-[#1E2A56]/60">{t("appointments.loading")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-[#1E2A56]">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#1E2A56]">{t("settings.title")}</h1>
        <p className="text-sm text-[#1E2A56]/50 mt-1">{t("settings.subtitle")}</p>
      </div>

      {/* Floating Success / Error Alerts */}
      <div className="fixed top-5 right-5 z-[100] space-y-2 pointer-events-none">
        {successMsg && (
          <div className="bg-emerald-500 text-white font-semibold text-sm px-6 py-3.5 rounded-2xl shadow-xl flex items-center gap-2 animate-[scaleIn_0.3s_ease-out] max-w-sm pointer-events-auto">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z" />
            </svg>
            <span>{successMsg}</span>
          </div>
        )}
        {errorMsg && (
          <div className="bg-rose-500 text-white font-semibold text-sm px-6 py-3.5 rounded-2xl shadow-xl flex items-center gap-2 animate-[scaleIn_0.3s_ease-out] max-w-sm pointer-events-auto">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Navigation Sidebar Cards */}
        <div className="w-full lg:w-64 bg-white rounded-3xl p-4 border border-white/40 shadow-[0_4px_20px_rgba(30,42,86,0.03)] flex flex-row lg:flex-col gap-1.5 overflow-x-auto lg:overflow-x-visible">
          {[
            { id: "profile", label: t("settings.tabs.profile"), icon: (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            ) },
            { id: "consultation", label: t("settings.tabs.consultation"), icon: (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            ) },
            { id: "security", label: t("settings.tabs.security"), icon: (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
            ) },
            { id: "data", label: t("settings.tabs.data"), icon: (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0v3.75" />
              </svg>
            ) }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition-all duration-200 cursor-pointer whitespace-nowrap lg:whitespace-normal w-full select-none ${
                activeTab === tab.id
                  ? "bg-[#e91e8c]/10 text-[#e91e8c]"
                  : "text-navy/60 hover:bg-[#1E2A56]/5"
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Configurations Forms Container */}
        <div className="flex-1 w-full bg-white rounded-3xl p-6 md:p-8 border border-white/40 shadow-[0_4px_20px_rgba(30,42,86,0.03)] min-h-[460px]">
          {/* Tab 1: Profile */}
          {activeTab === "profile" && (
            <form onSubmit={handleSaveProfile} className="space-y-6">
              <div>
                <h2 className="text-lg font-bold text-[#1E2A56]">{t("settings.profile.title")}</h2>
                <p className="text-xs text-[#1E2A56]/50 mt-1">{t("settings.profile.subtitle")}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-bold text-navy/55 uppercase tracking-wider mb-2">
                    {t("settings.profile.name")}
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full px-4 py-3 text-sm bg-bg/50 border border-navy/[0.08] rounded-2xl text-navy placeholder:text-navy/20 focus:outline-none focus:border-[#e91e8c]/40 focus:bg-white transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-navy/55 uppercase tracking-wider mb-2">
                    {t("settings.profile.speciality")}
                  </label>
                  <input
                    type="text"
                    required
                    value={speciality}
                    onChange={(e) => setSpeciality(e.target.value)}
                    className="w-full px-4 py-3 text-sm bg-bg/50 border border-navy/[0.08] rounded-2xl text-navy placeholder:text-navy/20 focus:outline-none focus:border-[#e91e8c]/40 focus:bg-white transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-navy/55 uppercase tracking-wider mb-2">
                    {t("settings.profile.phone")}
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-4 py-3 text-sm bg-bg/50 border border-navy/[0.08] rounded-2xl text-navy placeholder:text-navy/20 focus:outline-none focus:border-[#e91e8c]/40 focus:bg-white transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-navy/55 uppercase tracking-wider mb-2">
                    {t("settings.profile.email")}
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-3 text-sm bg-bg/50 border border-navy/[0.08] rounded-2xl text-navy placeholder:text-navy/20 focus:outline-none focus:border-[#e91e8c]/40 focus:bg-white transition-all"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-navy/55 uppercase tracking-wider mb-2">
                    {t("settings.profile.address")}
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full px-4 py-3 text-sm bg-bg/50 border border-navy/[0.08] rounded-2xl text-navy placeholder:text-navy/20 focus:outline-none focus:border-[#e91e8c]/40 focus:bg-white transition-all"
                  />
                </div>
              </div>

              {/* PDF Preview Attachment path if exist */}
              {profile?.pdfPath && (
                <div className="p-4 bg-navy/[0.02] border border-navy/[0.06] rounded-2xl flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                      </svg>
                    </div>
                    <div className="truncate">
                      <span className="text-xs font-bold text-navy block">En-tête PDF Ordonnance</span>
                      <span className="text-[10px] text-gray-400 block truncate font-medium">{profile.pdfPath}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => (window as any).ipcRenderer.openDocument(profile.pdfPath!)}
                    className="flex-shrink-0 bg-navy/5 hover:bg-navy/10 text-navy text-xs font-bold px-3.5 py-2 rounded-xl transition-all cursor-pointer select-none"
                  >
                    Ouvrir
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={saving}
                className="w-full md:w-auto px-8 py-3 rounded-2xl bg-gradient-to-r from-navy to-navy-light hover:from-navy-light hover:to-navy text-white text-sm font-semibold shadow-[0_4px_14px_rgba(30,42,86,0.2)] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50"
              >
                {saving ? t("settings.profile.saving") : t("settings.profile.save")}
              </button>
            </form>
          )}

          {/* Tab 2: Consultation Configuration */}
          {activeTab === "consultation" && (
            <form onSubmit={handleSaveConsultation} className="space-y-6">
              <div>
                <h2 className="text-lg font-bold text-[#1E2A56]">{t("settings.consultation.title")}</h2>
                <p className="text-xs text-[#1E2A56]/50 mt-1">{t("settings.consultation.subtitle")}</p>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-navy/55 uppercase tracking-wider mb-2">
                    {t("settings.consultation.price")}
                  </label>
                  <div className="relative max-w-sm">
                    <input
                      type="number"
                      required
                      value={defaultPrice}
                      onChange={(e) => setDefaultPrice(e.target.value)}
                      className="w-full px-4 py-3 text-sm bg-bg/50 border border-navy/[0.08] rounded-2xl text-navy focus:outline-none focus:border-[#e91e8c]/40 focus:bg-white transition-all"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-[#e91e8c]">
                      DA
                    </span>
                  </div>
                  <span className="text-[10px] text-gray-400 font-medium mt-1.5 block">
                    {t("settings.consultation.price_hint")}
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-navy/55 uppercase tracking-wider mb-2">
                    {t("settings.consultation.duration")}
                  </label>
                  <select
                    value={defaultDuration}
                    onChange={(e) => setDefaultDuration(e.target.value)}
                    className="w-full max-w-sm px-4 py-3 text-sm bg-bg/50 border border-navy/[0.08] rounded-2xl text-navy focus:outline-none focus:border-[#e91e8c]/40 focus:bg-white transition-all appearance-none cursor-pointer"
                  >
                    <option value="15">{t("settings.consultation.duration_minutes", { count: 15 })}</option>
                    <option value="20">{t("settings.consultation.duration_minutes", { count: 20 })}</option>
                    <option value="30">{t("settings.consultation.duration_minutes", { count: 30 })}</option>
                    <option value="45">{t("settings.consultation.duration_minutes", { count: 45 })}</option>
                    <option value="60">{t("settings.consultation.duration_minutes", { count: 60 })}</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                className="w-full md:w-auto px-8 py-3 rounded-2xl bg-gradient-to-r from-navy to-navy-light hover:from-navy-light hover:to-navy text-white text-sm font-semibold shadow-[0_4px_14px_rgba(30,42,86,0.2)] active:scale-[0.98] transition-all cursor-pointer"
              >
                {t("settings.consultation.save")}
              </button>
            </form>
          )}

          {/* Tab 3: Security & Session */}
          {activeTab === "security" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold text-[#1E2A56]">{t("settings.security.title")}</h2>
                <p className="text-xs text-[#1E2A56]/50 mt-1">{t("settings.security.subtitle")}</p>
              </div>

              {currentUser && (
                <div className="p-5 bg-navy/[0.02] border border-navy/[0.06] rounded-3xl space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-navy text-white font-extrabold text-lg flex items-center justify-center">
                      {currentUser.fullName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="text-base font-bold text-navy">{currentUser.fullName}</h4>
                      <p className="text-xs font-semibold text-pink-500 uppercase tracking-widest mt-0.5">
                        {currentUser.role === "doctor" ? "Médecin" : currentUser.role}
                      </p>
                    </div>
                  </div>

                  <div className="h-px bg-navy/[0.06]" />

                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-navy/55">{t("settings.security.role")} :</span>
                    <span className="text-navy uppercase tracking-wider">{currentUser.role}</span>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleLogout}
                className="px-8 py-3 rounded-2xl bg-gradient-to-r from-[#e91e8c] to-pink-light hover:from-pink-light hover:to-[#e91e8c] text-white text-sm font-semibold shadow-[0_4px_14px_rgba(233,30,140,0.25)] active:scale-[0.98] transition-all cursor-pointer select-none"
              >
                {t("settings.security.logout")}
              </button>
            </div>
          )}

          {/* Tab 4: Backup & Wiping */}
          {activeTab === "data" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold text-[#1E2A56]">{t("settings.data.title")}</h2>
                <p className="text-xs text-[#1E2A56]/50 mt-1">{t("settings.data.subtitle")}</p>
              </div>

              {/* Data Export Card */}
              <div className="p-5 bg-bg/30 border border-navy/[0.06] rounded-3xl space-y-4">
                <h3 className="text-sm font-bold text-navy">Sauvegarde des Patients</h3>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={handleExportJSON}
                    className="flex-1 flex items-center justify-center gap-2 bg-white border border-navy/10 hover:border-pink/40 text-navy hover:text-[#e91e8c] text-xs font-bold px-4 py-3 rounded-2xl transition-all cursor-pointer select-none"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    {t("settings.data.export_patients")}
                  </button>

                  <button
                    onClick={handleExportCSV}
                    className="flex-1 flex items-center justify-center gap-2 bg-white border border-navy/10 hover:border-pink/40 text-navy hover:text-[#e91e8c] text-xs font-bold px-4 py-3 rounded-2xl transition-all cursor-pointer select-none"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    {t("settings.data.export_patients_csv")}
                  </button>
                </div>
              </div>

              {/* Data Reset Danger Section */}
              <div className="p-5 bg-rose-50/50 border border-rose-100 rounded-3xl space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-rose-800">{t("settings.data.reset_db")}</h3>
                  <p className="text-xs text-rose-700/80 leading-relaxed mt-1">
                    {t("settings.data.reset_warning")}
                  </p>
                </div>

                {!showResetConfirmModal ? (
                  <button
                    onClick={() => setShowResetConfirmModal(true)}
                    className="w-full sm:w-auto px-6 py-2.5 rounded-2xl border-2 border-rose-500/20 hover:border-rose-500 text-rose-600 hover:bg-rose-50 text-xs font-bold transition-all cursor-pointer select-none"
                  >
                    {t("settings.data.reset_db")}
                  </button>
                ) : (
                  <div className="space-y-3 animate-[fadeIn_0.2s_ease-out]">
                    <label className="block text-xs font-bold text-rose-800">
                      {t("settings.data.reset_confirm")}
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <input
                        type="text"
                        placeholder="RESET"
                        value={confirmResetText}
                        onChange={(e) => setConfirmResetText(e.target.value)}
                        className="flex-1 px-4 py-2.5 text-sm bg-white border border-rose-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-rose-200 focus:border-rose-400 text-rose-900 placeholder:text-rose-300 font-extrabold tracking-widest text-center"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleWipeDatabase}
                          className="px-6 py-2.5 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-600/20 active:scale-[0.98] transition-all cursor-pointer select-none"
                        >
                          Confirmer
                        </button>
                        <button
                          onClick={() => {
                            setShowResetConfirmModal(false);
                            setConfirmResetText("");
                          }}
                          className="px-4 py-2.5 rounded-2xl bg-gray-100 hover:bg-gray-200 text-navy/70 text-xs font-bold transition-all cursor-pointer select-none"
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
