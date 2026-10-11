import Image from 'next/image';
import type { LandingCompany } from './types';
import { companyDisplayName, companyLogoSrc } from '@/lib/company-brand';
import styles from './CompanyLogo.module.css';

export function CompanyLogo({ company, className }: { company: Pick<LandingCompany, 'name' | 'logoSrc'>; className?: string }) {
  const src = company.logoSrc ?? companyLogoSrc(company.name);
  return src ? <Image src={src} alt="" aria-hidden="true" width={96} height={96} unoptimized className={`${styles.logo} ${className ?? ''}`} /> : <>{companyDisplayName(company.name).charAt(0).toUpperCase()}</>;
}
