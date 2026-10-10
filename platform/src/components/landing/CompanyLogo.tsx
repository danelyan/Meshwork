import Image from 'next/image';
import type { LandingCompany } from './types';

export function CompanyLogo({ company, className }: { company: Pick<LandingCompany, 'name' | 'logoSrc'>; className?: string }) {
  return company.logoSrc ? <Image src={company.logoSrc} alt="" aria-hidden="true" width={96} height={96} unoptimized className={className} /> : <>{company.name.charAt(0).toUpperCase()}</>;
}
