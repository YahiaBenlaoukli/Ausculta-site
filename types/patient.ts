export enum BloodType {
    A_POS = 'A+',
    A_NEG = 'A-',
    B_POS = 'B+',
    B_NEG = 'B-',
    AB_POS = 'AB+',
    AB_NEG = 'AB-',
    O_POS = 'O+',
    O_NEG = 'O-'
}

export type Patient = {
    id: number;
    fullName: string;
    dateOfBirth: string;
    address: string;
    phoneNumber: string;
    /** Nullable: a walk-in is often registered before their SSN is known, and
     *  the column is UNIQUE — so absent must be NULL, not an empty string. */
    ssn: string | null;
    bloodType: BloodType | null;
    notes?: string | null;
    createdAt: string;
};