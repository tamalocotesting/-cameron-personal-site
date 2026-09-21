/**
 * Structured data.
 *
 * Only facts that have been supplied go in here. There is deliberately no
 * PostalAddress, no openingHours, no aggregateRating, no review and no
 * priceRange precision beyond the published "starting around" figures —
 * inventing any of them would be fabricating a business fact, and the
 * structured-data spec treats several of them as review signals.
 */
import { brand } from '../config/brand';
import { allAreas } from '../data/service-areas';

const abs = (site: URL | undefined, path: string) => new URL(path, site ?? 'https://miseops.com').href;

/**
 * ProfessionalService rather than LocalBusiness: MISE OPS works on site in
 * client restaurants and does not operate a public premises, so it has no
 * address or opening hours to declare. areaServed carries the geography.
 */
export function organizationSchema(site: URL | undefined) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfessionalService',
    '@id': abs(site, '/#organization'),
    name: brand.name,
    url: abs(site, '/'),
    description: brand.description,
    slogan: brand.tagline,
    email: brand.email,
    ...(brand.phone ? { telephone: brand.phone } : {}),
    areaServed: allAreas.map((area) => ({
      '@type': 'City',
      name: area.city,
      containedInPlace: { '@type': 'AdministrativeArea', name: `${area.county}, Indiana` },
    })),
    serviceType: 'Restaurant operations documentation and training systems',
    knowsAbout: [
      'Restaurant standard operating procedures',
      'Recipe and build documentation',
      'Opening and closing procedures',
      'Food safety procedures',
      'Staff onboarding and training',
      'Kitchen equipment troubleshooting',
    ],
  };
}

export function webSiteSchema(site: URL | undefined) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': abs(site, '/#website'),
    url: abs(site, '/'),
    name: brand.name,
    description: brand.description,
    publisher: { '@id': abs(site, '/#organization') },
  };
}

export function faqSchema(items: readonly { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };
}
