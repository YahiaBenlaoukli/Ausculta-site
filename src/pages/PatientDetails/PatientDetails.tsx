import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function PatientDetails() {
    // Grab the 'id' from the route /patient/:id
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { t, i18n } = useTranslation();
    const isRtl = i18n.dir() === 'rtl';

    const [patientData, setPatientData] = useState(null);

    useEffect(() => {
        // You now have the ID! Use it to fetch the data via IPC or an API.
        console.log("Fetching data for patient ID:", id);

        // Example: window.electronAPI.getPatient(id).then(setPatientData);
    }, [id]);

    return (
        <div className="space-y-4">
            <button
                onClick={() => navigate(-1)}
                className="px-4 py-2 text-sm bg-navy/5 text-navy hover:bg-navy/10 rounded-xl transition-colors cursor-pointer"
            >
                {isRtl ? '→' : '←'} {t('patient_details.back')}
            </button>
            <h2 className="text-xl font-bold text-navy">{t('patient_details.title', { id })}</h2>
            {/* Render your extra info here */}
        </div>
    );
}