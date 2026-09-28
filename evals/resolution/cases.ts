import { normalizeSurfaceForm } from "@/lib/entities/normalize";
import type {
  CatalogCompany,
  CatalogPerson,
  CatalogProperty,
  ResolutionCatalog,
  ResolutionObservation,
} from "@/lib/resolution/types";

export interface ResolutionCase {
  id: string;
  observation: ResolutionObservation;
  catalog: ResolutionCatalog;
  requiredIds: string[];
  topId: string | null;
  forbiddenIds: string[];
  expect?: {
    historicalEmployer?: boolean;
    differentEmail?: boolean;
    emailExact?: boolean;
    sharedInboxIgnored?: boolean;
  };
}

function observation(
  input: Partial<ResolutionObservation> &
    Pick<ResolutionObservation, "id" | "workspaceId" | "observedType" | "surfaceForm">
): ResolutionObservation {
  return {
    title: null,
    email: null,
    phone: null,
    domain: null,
    addressLine1: null,
    city: null,
    region: null,
    postalCode: null,
    country: null,
    linkedIn: null,
    externalId: null,
    dealId: null,
    documentDate: null,
    relationships: [],
    ...input,
    normalizedName: input.normalizedName ?? normalizeSurfaceForm(input.surfaceForm),
  };
}

function person(input: Partial<CatalogPerson> & Pick<CatalogPerson, "id" | "canonicalName">): CatalogPerson {
  return {
    workspaceId: "ws-a",
    primaryTitle: null,
    status: "ACTIVE",
    aliases: [],
    emails: [],
    phones: [],
    linkedIns: [],
    employments: [],
    dealIds: [],
    ...input,
  };
}

function company(input: Partial<CatalogCompany> & Pick<CatalogCompany, "id" | "canonicalName">): CatalogCompany {
  return {
    workspaceId: "ws-a",
    legalName: null,
    primaryDomain: null,
    status: "ACTIVE",
    aliases: [],
    domains: [],
    externalIds: [],
    dealIds: [],
    ...input,
  };
}

function property(input: Partial<CatalogProperty> & Pick<CatalogProperty, "id" | "canonicalName">): CatalogProperty {
  return {
    workspaceId: "ws-a",
    addressLine1: null,
    addressLine2: null,
    city: null,
    region: null,
    postalCode: null,
    country: null,
    status: "ACTIVE",
    aliases: [],
    externalIds: [],
    dealIds: [],
    ...input,
  };
}

function catalog(input: Partial<ResolutionCatalog> = {}): ResolutionCatalog {
  return { people: input.people ?? [], companies: input.companies ?? [], properties: input.properties ?? [] };
}

const linkedIn = "https://www.linkedin.com/in/sarahchen";

export const resolutionCases: ResolutionCase[] = [
  {
    id: "01-exact-person-email",
    observation: observation({
      id: "obs-1",
      workspaceId: "ws-a",
      observedType: "PERSON",
      surfaceForm: "Sarah Chen",
      email: "sarah.chen@jll.com",
    }),
    catalog: catalog({
      people: [
        person({ id: "sarah", canonicalName: "Sarah Chen", emails: ["sarah.chen@jll.com"] }),
        person({ id: "other", canonicalName: "Dana Cho", emails: ["dana.cho@cbre.com"] }),
      ],
    }),
    requiredIds: ["sarah"],
    topId: "sarah",
    forbiddenIds: ["other"],
    expect: { emailExact: true },
  },
  {
    id: "02-exact-person-phone",
    observation: observation({
      id: "obs-2",
      workspaceId: "ws-a",
      observedType: "PERSON",
      surfaceForm: "Dana Cho",
      phone: "6175550199",
    }),
    catalog: catalog({
      people: [
        person({ id: "dana", canonicalName: "Dana Cho", phones: ["6175550199"] }),
        person({ id: "other", canonicalName: "Alex Kim", phones: ["2125550100"] }),
      ],
    }),
    requiredIds: ["dana"],
    topId: "dana",
    forbiddenIds: ["other"],
  },
  {
    id: "03-exact-linkedin",
    observation: observation({
      id: "obs-3",
      workspaceId: "ws-a",
      observedType: "PERSON",
      surfaceForm: "Sarah L. Chen",
      linkedIn,
    }),
    catalog: catalog({
      people: [person({ id: "sarah", canonicalName: "Sarah Chen", linkedIns: [normalizeSurfaceForm(linkedIn)] })],
    }),
    requiredIds: ["sarah"],
    topId: "sarah",
    forbiddenIds: [],
  },
  {
    id: "04-exact-name-only",
    observation: observation({
      id: "obs-4",
      workspaceId: "ws-a",
      observedType: "PERSON",
      surfaceForm: "Sarah Chen",
    }),
    catalog: catalog({
      people: [
        person({ id: "sarah", canonicalName: "Sarah Chen" }),
        person({ id: "other", canonicalName: "Robert Miles" }),
      ],
    }),
    requiredIds: ["sarah"],
    topId: "sarah",
    forbiddenIds: ["other"],
  },
  {
    id: "05-same-name-different-people",
    observation: observation({
      id: "obs-5",
      workspaceId: "ws-a",
      observedType: "PERSON",
      surfaceForm: "John Smith",
      email: "john.smith@cbre.com",
      relationships: [
        {
          predicate: "WORKS_AT",
          objectNormalizedName: "cbre",
          objectSurfaceForm: "CBRE",
          evidenceQuote: "John Smith of CBRE.",
          statedValidFrom: null,
          statedValidTo: null,
        },
      ],
    }),
    catalog: catalog({
      people: [
        person({
          id: "smith-cbre",
          canonicalName: "John Smith",
          emails: ["john.smith@cbre.com"],
          employments: [{ companyName: "CBRE", aliases: [], validTo: null, status: "ASSERTED" }],
        }),
        person({
          id: "smith-jll",
          canonicalName: "John Smith",
          emails: ["john.smith@jll.com"],
          employments: [{ companyName: "JLL", aliases: [], validTo: null, status: "ASSERTED" }],
        }),
      ],
    }),
    requiredIds: ["smith-cbre", "smith-jll"],
    topId: "smith-cbre",
    forbiddenIds: [],
    expect: { differentEmail: true },
  },
  {
    id: "06-employer-context",
    observation: observation({
      id: "obs-6",
      workspaceId: "ws-a",
      observedType: "PERSON",
      surfaceForm: "Sarah Chen",
      relationships: [
        {
          predicate: "WORKS_AT",
          objectNormalizedName: "jll",
          objectSurfaceForm: "JLL",
          evidenceQuote: "Sarah Chen works at JLL.",
          statedValidFrom: null,
          statedValidTo: null,
        },
      ],
    }),
    catalog: catalog({
      people: [
        person({
          id: "sarah-jll",
          canonicalName: "Sarah Chen",
          employments: [{ companyName: "JLL", aliases: [], validTo: null, status: "ASSERTED" }],
        }),
        person({
          id: "sarah-cbre",
          canonicalName: "Sarah Chen",
          employments: [{ companyName: "CBRE", aliases: [], validTo: null, status: "ASSERTED" }],
        }),
      ],
    }),
    requiredIds: ["sarah-jll", "sarah-cbre"],
    topId: "sarah-jll",
    forbiddenIds: [],
  },
  {
    id: "07-historical-employer",
    observation: observation({
      id: "obs-7",
      workspaceId: "ws-a",
      observedType: "PERSON",
      surfaceForm: "Sarah Chen",
      email: "sarah.chen@jll.com",
      documentDate: "2024-06-01T00:00:00.000Z",
      relationships: [
        {
          predicate: "WORKS_AT",
          objectNormalizedName: "cbre",
          objectSurfaceForm: "CBRE",
          evidenceQuote: "Sarah Chen previously worked at CBRE.",
          statedValidFrom: null,
          statedValidTo: null,
        },
      ],
    }),
    catalog: catalog({
      people: [
        person({
          id: "sarah",
          canonicalName: "Sarah Chen",
          emails: ["sarah.chen@jll.com"],
          employments: [
            { companyName: "JLL", aliases: [], validTo: null, status: "ASSERTED" },
            { companyName: "CBRE", aliases: [], validTo: "2023-01-01T00:00:00.000Z", status: "ASSERTED" },
          ],
        }),
      ],
    }),
    requiredIds: ["sarah"],
    topId: "sarah",
    forbiddenIds: [],
    expect: { historicalEmployer: true, emailExact: true },
  },
  {
    id: "08-shared-inbox",
    observation: observation({
      id: "obs-8",
      workspaceId: "ws-a",
      observedType: "PERSON",
      surfaceForm: "Leasing Desk",
      email: "leasing@cbre.com",
    }),
    catalog: catalog({
      people: [person({ id: "alex", canonicalName: "Alex Kim", emails: ["leasing@cbre.com"] })],
    }),
    requiredIds: [],
    topId: null,
    forbiddenIds: ["alex"],
    expect: { sharedInboxIgnored: true },
  },
  {
    id: "09-exact-company-domain",
    observation: observation({
      id: "obs-9",
      workspaceId: "ws-a",
      observedType: "COMPANY",
      surfaceForm: "JLL",
      domain: "jll.com",
    }),
    catalog: catalog({
      companies: [
        company({ id: "jll", canonicalName: "Jones Lang LaSalle", primaryDomain: "jll.com", domains: ["jll.com"] }),
        company({ id: "cbre", canonicalName: "CBRE", primaryDomain: "cbre.com", domains: ["cbre.com"] }),
      ],
    }),
    requiredIds: ["jll"],
    topId: "jll",
    forbiddenIds: ["cbre"],
  },
  {
    id: "10-company-exact-name",
    observation: observation({
      id: "obs-10",
      workspaceId: "ws-a",
      observedType: "COMPANY",
      surfaceForm: "Boston Properties",
    }),
    catalog: catalog({
      companies: [
        company({ id: "bxp", canonicalName: "Boston Properties" }),
        company({ id: "google", canonicalName: "Google" }),
      ],
    }),
    requiredIds: ["bxp"],
    topId: "bxp",
    forbiddenIds: ["google"],
  },
  {
    id: "11-company-alias",
    observation: observation({
      id: "obs-11",
      workspaceId: "ws-a",
      observedType: "COMPANY",
      surfaceForm: "JLL",
    }),
    catalog: catalog({
      companies: [
        company({ id: "jll", canonicalName: "Jones Lang LaSalle", aliases: ["jll"] }),
        company({ id: "jll-boston", canonicalName: "JLL Boston" }),
      ],
    }),
    requiredIds: ["jll"],
    topId: "jll",
    forbiddenIds: ["jll-boston"],
  },
  {
    id: "12-cbre-versus-cbre-group",
    observation: observation({
      id: "obs-12",
      workspaceId: "ws-a",
      observedType: "COMPANY",
      surfaceForm: "CBRE",
    }),
    catalog: catalog({ companies: [company({ id: "cbre-group", canonicalName: "CBRE Group" })] }),
    requiredIds: [],
    topId: null,
    forbiddenIds: ["cbre-group"],
  },
  {
    id: "13-jll-versus-jll-boston",
    observation: observation({
      id: "obs-13",
      workspaceId: "ws-a",
      observedType: "COMPANY",
      surfaceForm: "JLL",
    }),
    catalog: catalog({ companies: [company({ id: "jll-boston", canonicalName: "JLL Boston" })] }),
    requiredIds: [],
    topId: null,
    forbiddenIds: ["jll-boston"],
  },
  {
    id: "14-exact-property-address",
    observation: observation({
      id: "obs-14",
      workspaceId: "ws-a",
      observedType: "PROPERTY",
      surfaceForm: "200 Clarendon Street",
      addressLine1: "200 Clarendon Street",
      city: "Boston",
      region: "MA",
    }),
    catalog: catalog({
      properties: [
        property({
          id: "hancock",
          canonicalName: "John Hancock Tower",
          addressLine1: "200 Clarendon Street",
          city: "Boston",
          region: "MA",
        }),
        property({
          id: "other",
          canonicalName: "Prudential Center",
          addressLine1: "800 Boylston Street",
          city: "Boston",
          region: "MA",
        }),
      ],
    }),
    requiredIds: ["hancock"],
    topId: "hancock",
    forbiddenIds: ["other"],
  },
  {
    id: "15-property-alias",
    observation: observation({
      id: "obs-15",
      workspaceId: "ws-a",
      observedType: "PROPERTY",
      surfaceForm: "John Hancock Tower",
    }),
    catalog: catalog({
      properties: [
        property({
          id: "clarendon",
          canonicalName: "200 Clarendon Street",
          aliases: ["john hancock tower"],
          city: "Boston",
          region: "MA",
        }),
      ],
    }),
    requiredIds: ["clarendon"],
    topId: "clarendon",
    forbiddenIds: [],
  },
  {
    id: "16-same-property-name-different-cities",
    observation: observation({
      id: "obs-16",
      workspaceId: "ws-a",
      observedType: "PROPERTY",
      surfaceForm: "Commerce Place",
      city: "Boston",
    }),
    catalog: catalog({
      properties: [
        property({ id: "boston", canonicalName: "Commerce Place", city: "Boston", region: "MA", addressLine1: "1 Main Street" }),
        property({ id: "chicago", canonicalName: "Commerce Place", city: "Chicago", region: "IL", addressLine1: "1 Main Street" }),
      ],
    }),
    requiredIds: ["boston", "chicago"],
    topId: "boston",
    forbiddenIds: [],
  },
  {
    id: "17-renamed-property",
    observation: observation({
      id: "obs-17",
      workspaceId: "ws-a",
      observedType: "PROPERTY",
      surfaceForm: "200 Clarendon",
    }),
    catalog: catalog({
      properties: [
        property({ id: "hancock", canonicalName: "John Hancock Tower", aliases: ["200 clarendon"], city: "Boston" }),
        property({ id: "other", canonicalName: "Berkeley Place", city: "Boston" }),
      ],
    }),
    requiredIds: ["hancock"],
    topId: "hancock",
    forbiddenIds: ["other"],
  },
  {
    id: "18-missing-identifiers",
    observation: observation({
      id: "obs-18",
      workspaceId: "ws-a",
      observedType: "PERSON",
      surfaceForm: "Priya Shah",
    }),
    catalog: catalog({ people: [person({ id: "priya", canonicalName: "Priya Shah" })] }),
    requiredIds: ["priya"],
    topId: "priya",
    forbiddenIds: [],
  },
  {
    id: "19-conflicting-identifiers",
    observation: observation({
      id: "obs-19",
      workspaceId: "ws-a",
      observedType: "PERSON",
      surfaceForm: "Sarah Chen",
      email: "sarah.chen@jll.com",
    }),
    catalog: catalog({
      people: [person({ id: "sarah", canonicalName: "Sarah Chen", emails: ["sarah.chen@cbre.com"] })],
    }),
    requiredIds: ["sarah"],
    topId: "sarah",
    forbiddenIds: [],
    expect: { differentEmail: true },
  },
  {
    id: "20-cross-workspace",
    observation: observation({
      id: "obs-20",
      workspaceId: "ws-a",
      observedType: "PERSON",
      surfaceForm: "Sarah Chen",
      email: "sarah.chen@jll.com",
    }),
    catalog: catalog({
      people: [
        person({
          id: "other-workspace",
          workspaceId: "ws-b",
          canonicalName: "Sarah Chen",
          emails: ["sarah.chen@jll.com"],
        }),
      ],
    }),
    requiredIds: [],
    topId: null,
    forbiddenIds: ["other-workspace"],
  },
  {
    id: "21-same-broker-multiple-deals",
    observation: observation({
      id: "obs-21",
      workspaceId: "ws-a",
      observedType: "PERSON",
      surfaceForm: "Sarah Chen",
      email: "sarah.chen@jll.com",
      dealId: "deal-2",
    }),
    catalog: catalog({
      people: [
        person({
          id: "sarah",
          canonicalName: "Sarah Chen",
          emails: ["sarah.chen@jll.com"],
          dealIds: ["deal-1"],
        }),
      ],
    }),
    requiredIds: ["sarah"],
    topId: "sarah",
    forbiddenIds: [],
    expect: { emailExact: true },
  },
  {
    id: "22-same-company-multiple-documents",
    observation: observation({
      id: "obs-22",
      workspaceId: "ws-a",
      observedType: "COMPANY",
      surfaceForm: "Jones Lang LaSalle",
      domain: "jll.com",
      dealId: "deal-2",
    }),
    catalog: catalog({
      companies: [
        company({
          id: "jll",
          canonicalName: "Jones Lang LaSalle",
          primaryDomain: "jll.com",
          domains: ["jll.com"],
          dealIds: ["deal-1"],
        }),
      ],
    }),
    requiredIds: ["jll"],
    topId: "jll",
    forbiddenIds: [],
  },
  {
    id: "23-same-property-multiple-documents",
    observation: observation({
      id: "obs-23",
      workspaceId: "ws-a",
      observedType: "PROPERTY",
      surfaceForm: "John Hancock Tower",
      addressLine1: "200 Clarendon Street",
      city: "Boston",
      region: "MA",
      dealId: "deal-9",
    }),
    catalog: catalog({
      properties: [
        property({
          id: "hancock",
          canonicalName: "John Hancock Tower",
          addressLine1: "200 Clarendon Street",
          city: "Boston",
          region: "MA",
          dealIds: ["deal-1"],
        }),
      ],
    }),
    requiredIds: ["hancock"],
    topId: "hancock",
    forbiddenIds: [],
  },
  {
    id: "24-name-typo",
    observation: observation({
      id: "obs-24",
      workspaceId: "ws-a",
      observedType: "PERSON",
      surfaceForm: "Sara Chen",
    }),
    catalog: catalog({
      people: [
        person({ id: "sarah", canonicalName: "Sarah Chen" }),
        person({ id: "other", canonicalName: "Robert Miles" }),
      ],
    }),
    requiredIds: ["sarah"],
    topId: "sarah",
    forbiddenIds: ["other"],
  },
  {
    id: "25-unrelated-candidate",
    observation: observation({
      id: "obs-25",
      workspaceId: "ws-a",
      observedType: "PERSON",
      surfaceForm: "Sarah Chen",
    }),
    catalog: catalog({
      people: [person({ id: "robert", canonicalName: "Robert Miles" })],
      companies: [company({ id: "google", canonicalName: "Google" })],
    }),
    requiredIds: [],
    topId: null,
    forbiddenIds: ["robert"],
  },
];
