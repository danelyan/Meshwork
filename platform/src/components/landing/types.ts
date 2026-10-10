/** Public company examples, not platform employers or imported vacancies. */
export interface LandingCompany {
  id: string;
  name: string;
  focus: string;
  description: string | null;
  logoSrc?: string;
  careersUrl?: string;
}

export interface LandingData {
  companies: LandingCompany[];
}
