/** The record kinds the global search box can return. */
export type SearchResultType = 'patient' | 'consultation' | 'prescription' | 'document';

export interface SearchResult {
    type: SearchResultType;
    /** Primary key within the row's own table. */
    id: number;
    /** First line — the thing that matched (patient name, diagnosis, drug list…). */
    title: string;
    /** Second line — context. Null when the title says everything. */
    subtitle: string | null;
    /** ISO date of the underlying record, rendered on the right. Null for patients. */
    date: string | null;
    /** Owning patient. Drives navigation for every non-patient result. */
    patientId: number;
    /** Patient's name, shown as the context line on non-patient results. */
    patientName: string;
    /** Documents only: absolute path, handed to openDocument() on activation. */
    localPath?: string | null;
}

export interface GlobalSearchResults {
    patients: SearchResult[];
    consultations: SearchResult[];
    prescriptions: SearchResult[];
    documents: SearchResult[];
    /** Number of rows actually returned, across all groups. */
    total: number;
    /** True when at least one group hit its cap and is showing a partial list. */
    truncated: boolean;
}
