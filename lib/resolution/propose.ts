import {
  normalizeCompanyName,
  normalizeDomain,
  normalizeEmail,
  normalizePhone,
  normalizePropertyAddress,
  normalizeSurfaceForm,
} from "@/lib/entities/normalize";
import { isSharedInbox } from "./sharedInbox";
import {
  NAME_SIMILARITY_ALGORITHM,
  NAME_SIMILARITY_THRESHOLD,
  nameSimilarity,
  namesAreCompatible,
} from "./similarity";
import type {
  CatalogCompany,
  CatalogPerson,
  CatalogProperty,
  ResolutionCatalog,
  ResolutionFeatureSet,
  ResolutionObservation,
  ResolutionProposal,
} from "./types";

/**
 * Deterministic Phase 7B score. No model call. Nothing here accepts a candidate.
 *
 * Strong identifiers dominate fuzzy name similarity.
 * emailExact 0.62, phoneExact 0.58, linkedInExact 0.62,
 * domainExact 0.64, externalIdExact 0.60, addressExact 0.66,
 * nameExact 0.24, aliasExact 0.26, legalNameExact 0.30,
 * nameSimilarity at most 0.12 above a 0.92 Jaro-Winkler threshold,
 * sameObservedCompany 0.12, historicalEmployerMatch 0.10,
 * titleSimilarity 0.05, sameDealContext 0.08, sameCity 0.06.
 * Conflicts: differentEmail -0.50, incompatibleEmployers -0.22,
 * differentDomain -0.45, differentAddress -0.40, differentCity -0.28.
 * Shared inboxes add nothing. Score is clamped to 0.01–0.99.
 */
export const RESOLUTION_SCORING = {
  algorithm: NAME_SIMILARITY_ALGORITHM,
  normalization:
    "Phase 6B normalizeSurfaceForm / normalizeEmail / normalizePhone / normalizeDomain / normalizePropertyAddress. Suffixes are stripped only inside name similarity.",
  similarityThreshold: NAME_SIMILARITY_THRESHOLD,
  nameSimilarityMaxWeight: 0.12,
  scoreFloor: 0.01,
  scoreCeiling: 0.99,
  weights: {
    emailExact: 0.62,
    phoneExact: 0.58,
    linkedInExact: 0.62,
    nameExact: 0.24,
    aliasExact: 0.26,
    legalNameExact: 0.3,
    sameObservedCompany: 0.12,
    historicalEmployerMatch: 0.1,
    titleSimilarity: 0.05,
    sameDealContext: 0.08,
    domainExact: 0.64,
    externalIdExact: 0.6,
    addressExact: 0.66,
    sameCity: 0.06,
    differentEmail: -0.5,
    incompatibleEmployers: -0.22,
    differentDomain: -0.45,
    differentAddress: -0.4,
    differentCity: -0.28,
  },
} as const;

const HISTORICAL_TEXT = /\b(previously|formerly|former|used to|prior to joining)\b/i;

function emptyFeatures(): ResolutionFeatureSet {
  return {
    emailExact: false,
    phoneExact: false,
    linkedInExact: false,
    nameExact: false,
    aliasExact: false,
    nameSimilarity: 0,
    sameObservedCompany: false,
    historicalEmployerMatch: false,
    titleSimilarity: 0,
    sameDealContext: false,
    domainExact: false,
    legalNameExact: false,
    externalIdExact: false,
    addressExact: false,
    sameCity: false,
    differentEmail: false,
    incompatibleEmployers: false,
    historicalEmployer: false,
    differentDomain: false,
    differentAddress: false,
    differentCity: false,
    sharedInbox: false,
  };
}

function clampScore(raw: number): number {
  const clamped = Math.min(RESOLUTION_SCORING.scoreCeiling, Math.max(RESOLUTION_SCORING.scoreFloor, raw));
  return Math.round(clamped * 10000) / 10000;
}

function active(status: string): boolean {
  return status !== "MERGED";
}

function observedEmployers(observation: ResolutionObservation) {
  return observation.relationships.filter((relationship) => relationship.predicate === "WORKS_AT");
}

function employerIsHistorical(evidenceQuote: string, statedValidTo: string | null): boolean {
  return Boolean(statedValidTo) || HISTORICAL_TEXT.test(evidenceQuote);
}

function companyNames(name: string, aliases: string[]): string[] {
  return [normalizeCompanyName(name), ...aliases.map((alias) => normalizeCompanyName(alias))].filter(Boolean);
}

function addressesEqual(observation: ResolutionObservation, property: CatalogProperty): boolean {
  const observed = normalizePropertyAddress({
    addressLine1: observation.addressLine1,
    city: observation.city,
    region: observation.region,
    postalCode: observation.postalCode,
    country: observation.country,
  });
  const canonical = normalizePropertyAddress(property);
  return Boolean(observed) && observed === canonical;
}

function explain(features: ResolutionFeatureSet, documentDate: string | null): {
  score: number;
  positiveReasons: string[];
  negativeReasons: string[];
  temporalNotes: string[];
} {
  const weights = RESOLUTION_SCORING.weights;
  let raw = 0;
  const positiveReasons: string[] = [];
  const negativeReasons: string[] = [];
  const temporalNotes: string[] = [];

  if (features.emailExact) {
    raw += weights.emailExact;
    positiveReasons.push("Exact normalized email");
  }
  if (features.phoneExact) {
    raw += weights.phoneExact;
    positiveReasons.push("Exact normalized phone");
  }
  if (features.linkedInExact) {
    raw += weights.linkedInExact;
    positiveReasons.push("Exact LinkedIn identifier");
  }
  if (features.domainExact) {
    raw += weights.domainExact;
    positiveReasons.push("Exact normalized domain");
  }
  if (features.externalIdExact) {
    raw += weights.externalIdExact;
    positiveReasons.push("Exact external identifier");
  }
  if (features.addressExact) {
    raw += weights.addressExact;
    positiveReasons.push("Exact normalized address");
  }
  if (features.nameExact) {
    raw += weights.nameExact;
    positiveReasons.push("Exact normalized full name");
  } else if (features.aliasExact) {
    raw += weights.aliasExact;
    positiveReasons.push("Exact normalized alias");
  } else if (features.legalNameExact) {
    raw += weights.legalNameExact;
    positiveReasons.push("Exact normalized legal name");
  } else if (features.nameSimilarity >= NAME_SIMILARITY_THRESHOLD) {
    const span = 1 - NAME_SIMILARITY_THRESHOLD;
    raw += ((features.nameSimilarity - NAME_SIMILARITY_THRESHOLD) / span) * RESOLUTION_SCORING.nameSimilarityMaxWeight;
    positiveReasons.push(`Name similarity ${features.nameSimilarity.toFixed(2)}`);
  }
  if (features.sameObservedCompany) {
    raw += weights.sameObservedCompany;
    positiveReasons.push("Observed employer matches canonical employment");
  }
  if (features.historicalEmployerMatch) {
    raw += weights.historicalEmployerMatch;
    positiveReasons.push("Observed employer matches a prior employment");
  }
  if (features.titleSimilarity >= NAME_SIMILARITY_THRESHOLD) {
    raw += weights.titleSimilarity;
    positiveReasons.push("Title similarity");
  }
  if (features.sameDealContext) {
    raw += weights.sameDealContext;
    positiveReasons.push("Same deal context");
  }
  if (features.sameCity) {
    raw += weights.sameCity;
    positiveReasons.push("Same city");
  }
  if (features.differentEmail) {
    raw += weights.differentEmail;
    negativeReasons.push("Different known email");
  }
  if (features.incompatibleEmployers) {
    raw += weights.incompatibleEmployers;
    negativeReasons.push("Incompatible current employers");
  }
  if (features.differentDomain) {
    raw += weights.differentDomain;
    negativeReasons.push("Different known domain");
  }
  if (features.differentAddress) {
    raw += weights.differentAddress;
    negativeReasons.push("Different address");
  }
  if (features.differentCity) {
    raw += weights.differentCity;
    negativeReasons.push("Different city");
  }
  if (features.sharedInbox) {
    temporalNotes.push("Shared inbox is not a unique person identifier");
  }
  if (features.historicalEmployer) {
    temporalNotes.push("Employer difference is historical and does not reject identity");
  }
  if (documentDate) {
    temporalNotes.push(`Document date ${documentDate.slice(0, 10)} is temporal context`);
  }
  return {
    score: clampScore(raw),
    positiveReasons,
    negativeReasons,
    temporalNotes,
  };
}

function nameMatch(observed: string, canonical: string, aliases: string[]): {
  nameExact: boolean;
  aliasExact: boolean;
  similarity: number;
  compatible: boolean;
} {
  const normalized = normalizeSurfaceForm(observed);
  const canonicalNormalized = normalizeSurfaceForm(canonical);
  const aliasExact = aliases.some((alias) => normalizeSurfaceForm(alias) === normalized);
  const nameExact = canonicalNormalized === normalized;
  const candidates = [canonical, ...aliases];
  const similarity = Math.max(...candidates.map((value) => nameSimilarity(normalized, value)));
  const compatible = candidates.some((value) => namesAreCompatible(normalized, value));
  return { nameExact, aliasExact, similarity, compatible };
}

function proposePerson(observation: ResolutionObservation, person: CatalogPerson): ResolutionProposal | null {
  if (person.workspaceId !== observation.workspaceId || !active(person.status)) return null;
  const email = observation.email ? normalizeEmail(observation.email) : null;
  const shared = Boolean(email && isSharedInbox(email));
  const phone = observation.phone ? normalizePhone(observation.phone) : "";
  const linkedIn = observation.linkedIn ? normalizeSurfaceForm(observation.linkedIn) : "";
  const names = nameMatch(observation.normalizedName || observation.surfaceForm, person.canonicalName, person.aliases);
  const features = emptyFeatures();
  features.sharedInbox = shared;
  features.emailExact = Boolean(email && !shared && person.emails.includes(email));
  features.phoneExact = Boolean(phone && person.phones.includes(phone));
  features.linkedInExact = Boolean(linkedIn && person.linkedIns.includes(linkedIn));
  features.nameExact = names.nameExact;
  features.aliasExact = names.aliasExact && !names.nameExact;
  features.nameSimilarity = names.nameExact ? 1 : names.similarity;
  const personalEmails = person.emails.filter((value) => !isSharedInbox(value));
  features.differentEmail = Boolean(
    email && !shared && personalEmails.length > 0 && !personalEmails.includes(email)
  );

  const observed = observedEmployers(observation);
  const currentEmployers = person.employments.filter((employment) => employment.status === "ASSERTED" && !employment.validTo);
  const endedEmployers = person.employments.filter((employment) => employment.status === "ASSERTED" && employment.validTo);
  const matchesCompany = (employmentName: string, aliases: string[], observedName: string | null) => {
    if (!observedName) return false;
    return companyNames(employmentName, aliases).includes(normalizeCompanyName(observedName));
  };
  const currentObserved = observed.filter((relationship) => !employerIsHistorical(relationship.evidenceQuote, relationship.statedValidTo));
  const historicalObserved = observed.filter((relationship) => employerIsHistorical(relationship.evidenceQuote, relationship.statedValidTo));
  features.sameObservedCompany = currentObserved.some((relationship) =>
    currentEmployers.some((employment) =>
      matchesCompany(employment.companyName, employment.aliases, relationship.objectNormalizedName)
    )
  );
  features.historicalEmployerMatch = historicalObserved.some((relationship) =>
    [...currentEmployers, ...endedEmployers].some((employment) =>
      matchesCompany(employment.companyName, employment.aliases, relationship.objectNormalizedName)
    )
  );
  const currentConflict = currentObserved.some((relationship) => {
    if (!relationship.objectNormalizedName || currentEmployers.length === 0) return false;
    return !currentEmployers.some((employment) =>
      matchesCompany(employment.companyName, employment.aliases, relationship.objectNormalizedName)
    );
  });
  features.incompatibleEmployers = currentConflict;
  features.historicalEmployer = currentConflict
    ? false
    : historicalObserved.length > 0 && !features.sameObservedCompany;
  if (observation.title && person.primaryTitle) {
    features.titleSimilarity = nameSimilarity(observation.title, person.primaryTitle);
  }
  features.sameDealContext = Boolean(observation.dealId && person.dealIds.includes(observation.dealId));

  const blocked =
    features.emailExact ||
    features.phoneExact ||
    features.linkedInExact ||
    names.compatible;
  if (!blocked) return null;

  const explained = explain(features, observation.documentDate);
  const employer = currentEmployers.map((employment) => employment.companyName).join(", ");
  const context = [employer, features.emailExact ? email : null, person.primaryTitle]
    .filter(Boolean)
    .join(" · ");
  return {
    entityType: "PERSON",
    entityId: person.id,
    displayName: person.canonicalName,
    contextLabel: context,
    ...explained,
    features,
  };
}

function proposeCompany(observation: ResolutionObservation, company: CatalogCompany): ResolutionProposal | null {
  if (company.workspaceId !== observation.workspaceId || !active(company.status)) return null;
  const domain = observation.domain ? normalizeDomain(observation.domain) : "";
  const names = nameMatch(observation.normalizedName || observation.surfaceForm, company.canonicalName, company.aliases);
  const legal = company.legalName ? normalizeCompanyName(company.legalName) : "";
  const features = emptyFeatures();
  features.domainExact = Boolean(domain && (company.domains.includes(domain) || company.primaryDomain === domain));
  features.externalIdExact = Boolean(
    observation.externalId && company.externalIds.includes(normalizeSurfaceForm(observation.externalId))
  );
  features.nameExact = names.nameExact;
  features.aliasExact = names.aliasExact && !names.nameExact;
  features.legalNameExact = Boolean(legal && legal === normalizeCompanyName(observation.normalizedName || observation.surfaceForm) && !names.nameExact);
  features.nameSimilarity = names.nameExact ? 1 : names.similarity;
  features.sameDealContext = Boolean(observation.dealId && company.dealIds.includes(observation.dealId));
  const knownDomains = [...company.domains, company.primaryDomain].filter((value): value is string => Boolean(value));
  features.differentDomain = Boolean(domain && knownDomains.length > 0 && !knownDomains.includes(domain));
  const blocked = features.domainExact || features.externalIdExact || names.compatible || features.legalNameExact;
  if (!blocked) return null;
  const explained = explain(features, observation.documentDate);
  return {
    entityType: "COMPANY",
    entityId: company.id,
    displayName: company.canonicalName,
    contextLabel: [company.primaryDomain, company.legalName].filter(Boolean).join(" · "),
    ...explained,
    features,
  };
}

function proposeProperty(observation: ResolutionObservation, property: CatalogProperty): ResolutionProposal | null {
  if (property.workspaceId !== observation.workspaceId || !active(property.status)) return null;
  const names = nameMatch(observation.normalizedName || observation.surfaceForm, property.canonicalName, property.aliases);
  const features = emptyFeatures();
  features.addressExact = addressesEqual(observation, property);
  features.externalIdExact = Boolean(
    observation.externalId && property.externalIds.includes(normalizeSurfaceForm(observation.externalId))
  );
  features.nameExact = names.nameExact;
  features.aliasExact = names.aliasExact && !names.nameExact;
  features.nameSimilarity = names.nameExact ? 1 : names.similarity;
  features.sameDealContext = Boolean(observation.dealId && property.dealIds.includes(observation.dealId));
  const observedCity = observation.city ? normalizeSurfaceForm(observation.city) : "";
  const propertyCity = property.city ? normalizeSurfaceForm(property.city) : "";
  features.sameCity = Boolean(observedCity && propertyCity && observedCity === propertyCity);
  features.differentCity = Boolean(observedCity && propertyCity && observedCity !== propertyCity);
  features.differentAddress = Boolean(
    observation.addressLine1 &&
      property.addressLine1 &&
      normalizeSurfaceForm(observation.addressLine1) !== normalizeSurfaceForm(property.addressLine1)
  );
  const blocked = features.addressExact || features.externalIdExact || names.compatible;
  if (!blocked) return null;
  const explained = explain(features, observation.documentDate);
  const place = [property.city, property.region].filter(Boolean).join(", ");
  return {
    entityType: "PROPERTY",
    entityId: property.id,
    displayName: property.canonicalName,
    contextLabel: place,
    ...explained,
    features,
  };
}

export function proposeResolution(
  observation: ResolutionObservation,
  catalog: ResolutionCatalog
): ResolutionProposal[] {
  const proposals =
    observation.observedType === "PERSON"
      ? catalog.people.map((person) => proposePerson(observation, person))
      : observation.observedType === "COMPANY"
        ? catalog.companies.map((company) => proposeCompany(observation, company))
        : catalog.properties.map((property) => proposeProperty(observation, property));
  return proposals
    .filter((proposal): proposal is ResolutionProposal => proposal != null)
    .sort((left, right) => right.score - left.score || left.displayName.localeCompare(right.displayName) || left.entityId.localeCompare(right.entityId));
}
