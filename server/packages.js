/** Approved consultation offer. Online checkout stays off. */
export const PRICING_STATUS = "approved";

const checkoutOff = "Online checkout is off. Paid work begins only after a written agreement.";
const noGuarantee = "No contract award is guaranteed. ASBS does not guarantee a certification, financing, or agency approval.";
const ownsAccounts = "You submit and own your registrations and bids. ASBS does not collect passwords, one-time codes, Social Security numbers, or EINs.";
const civilian = "Veterans and soldiers in transition are never charged or targeted by ASBS. Sponsor-funded help for veterans stays separate and free to them.";
const agencyFees = "Government registrations are free or state-fee-only. ASBS charges for preparation and guidance. SAM.gov registration is free from the U.S. government. The Texas CMBL state fee ($70/yr) is paid by the client.";
const writtenSchedule = "Work begins after a signed written agreement. This website does not start the work.";

const sharedLimits = [civilian, noGuarantee, ownsAccounts, checkoutOff];

export const PACKAGES = [
  {
    id: "free-consultation",
    name: "Free consultation",
    price: "Free",
    priceNote: "An introductory call to understand your business and which sprint, if any, fits. No charge and no obligation.",
    customer: "A civilian business that wants a conversation before any paid consulting work.",
    deliverables: [
      "A conversation about where you are and where you want to sell.",
      "A recommended next step: Registration Sprint, Bid-Ready Sprint, or Monthly Bid Desk.",
    ],
    limitations: [
      "No charge and no obligation.",
      "Does not include registration guidance, a capability statement, bid-search alerts, or a monthly bid desk.",
      civilian,
      checkoutOff,
      noGuarantee,
    ],
    delivery: "A scheduled introductory call.",
    customerResponsibilities: [
      "Share enough about the business and goals for ASBS to recommend a next step.",
    ],
    upgrade: "Registration Sprint, Bid-Ready Sprint, or Monthly Bid Desk after a signed written agreement.",
    consultationType: "discovery_15",
  },
  {
    id: "registration-sprint",
    name: "Registration Sprint",
    price: "$397",
    priceNote: "Get registered where buyers look.",
    customer: "A civilian business that needs SAM.gov guidance, Texas CMBL, one city vendor portal, and a code map.",
    deliverables: [
      "SAM.gov registration guidance (UEI + entity).",
      "Texas CMBL registration (state $70/yr fee paid by client).",
      "One city vendor portal setup.",
      "NAICS + NIGP code map.",
      "Bid-ready checklist.",
    ],
    limitations: [
      "Covers one city vendor portal.",
      agencyFees,
      "You submit your own registrations and remain the owner of every government account.",
      ...sharedLimits,
    ],
    delivery: writtenSchedule,
    customerResponsibilities: [
      "Provide the business information the registrations need.",
      "Pay the Texas CMBL state fee directly.",
      "Submit each registration in your own name.",
      "Confirm the NAICS and NIGP codes.",
    ],
    upgrade: "Bid-Ready Sprint or Monthly Bid Desk.",
    consultationType: "qualified_30",
  },
  {
    id: "bid-ready-sprint",
    name: "Bid-Ready Sprint",
    price: "$747",
    priceNote: "Registered, coded, and ready to bid.",
    customer: "A civilian business that wants the Registration Sprint plus more portals, a capability statement, and a first look at solicitations.",
    deliverables: [
      "Everything in Registration Sprint.",
      "Up to 3 city / county / co-op portals.",
      "One-page capability statement.",
      "Bid-search alerts setup + review of your first 3 solicitations.",
    ],
    limitations: [
      "Portal setup is capped at 3 city, county, or co-op portals, in addition to the Registration Sprint registrations.",
      "Solicitation review covers the first 3 notices. It is not ongoing bid desk coverage and not proposal writing.",
      agencyFees,
      "You approve the capability statement and submit your own registrations.",
      ...sharedLimits,
    ],
    delivery: writtenSchedule,
    customerResponsibilities: [
      "Provide the information the registrations and capability statement need.",
      "Pay any state or portal fees directly.",
      "Submit registrations in your own name.",
      "Approve the one-page capability statement.",
    ],
    upgrade: "Monthly Bid Desk.",
    consultationType: "qualified_30",
  },
  {
    id: "monthly-bid-desk",
    name: "Monthly Bid Desk",
    price: "$297 / month",
    priceNote: "All contract levels. One desk. Bid/no-bid on 10 notices.",
    customer: "A civilian business that wants a productized retainer after a Sprint, with a human bid or no-bid on up to 10 notices a month.",
    deliverables: [
      "Productized retainer (upsell after the Sprint).",
      "Each month: curated pipeline across federal, Texas state, co-ops (BuyBoard, TIPS, Choice Partners, H-GAC, Sourcewell, OMNIA), counties/cities/ISDs/colleges, special districts, and private sector.",
      "Clear bid / no-bid on up to 10 notices.",
      "Stay in readiness + bid/no-bid — heavy proposal writing referred out.",
      "Edge vs federal-only AI alerts: human review across TX SLED, co-ops, and private work.",
    ],
    limitations: [
      "Bid or no-bid on up to 10 notices each month. Heavy proposal writing is referred out.",
      "This is readiness and bid/no-bid coverage. It does not include writing full proposals.",
      "No success fees or award fees.",
      civilian,
      agencyFees,
      noGuarantee,
      ownsAccounts,
      checkoutOff,
    ],
    delivery: "A monthly cycle after a signed written agreement.",
    customerResponsibilities: [
      "Make every bid or no-bid decision.",
      "Sign and submit in your own name.",
      "Keep the readiness information ASBS uses accurate.",
    ],
    upgrade: "Heavy proposal writing is referred out when a notice needs it.",
    consultationType: "onboarding_45",
  },
];

export function packageById(id) {
  return PACKAGES.find((item) => item.id === id) || null;
}
