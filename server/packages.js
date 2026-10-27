/** Approved package prices. Online checkout stays off until a later owner decision. */
export const PRICING_STATUS = "approved";

const checkoutOff = "Online checkout is off. Paid work begins only after a written agreement.";
const noGuarantee = "ASBS does not guarantee a contract award, a certification, financing, or agency approval.";
const ownsAccounts = "You submit and own your registrations and bids. ASBS does not collect passwords or one-time codes.";
const credited = "Purchased packages are credited toward the next package you choose.";
const agencyFees = "SAM.gov registration is free from the U.S. government. The ASBS fee is for preparation and review help, not a government fee. Agency fees, if any, are separate.";
const writtenSchedule = "The written agreement sets the schedule. This website does not start the work.";

const monthlyLimitations = [
  "Three-month minimum, then month-to-month. Cancel with 30 days' written notice. Unused bids do not roll over.",
  "No success fees or award fees.",
  "You approve pricing, make every bid or no-bid decision, and sign and submit in your own name.",
  "Extra bid beyond the tier: $300 each. An out-of-scope request is $75, quoted and approved before work starts. Rush bids due in under 7 days: contact ASBS.",
  noGuarantee,
  ownsAccounts,
  checkoutOff,
];

export const PACKAGES = [
  {
    id: "free-consultation",
    name: "Free consultation",
    price: "Free",
    priceNote: "An introductory call to understand your business and goals. No charge and no obligation.",
    customer: "A business that wants a conversation about where it is and where it wants to sell before any paid work.",
    deliverables: [
      "A conversation about where you are and where you want to sell.",
      "A recommended next step.",
    ],
    limitations: [
      "No charge and no obligation.",
      "Does not include a written scorecard, a solicitation review, registration preparation, or bid preparation.",
      checkoutOff,
      noGuarantee,
    ],
    delivery: "A scheduled introductory call.",
    customerResponsibilities: [
      "Share enough about the business and goals for ASBS to recommend a next step.",
    ],
    upgrade: "Bid Readiness Assessment, Quick Bid Review, or another package after the call.",
    consultationType: "discovery_15",
  },
  {
    id: "bid-readiness-assessment",
    name: "Bid Readiness Assessment",
    price: "$199",
    priceNote: "Credited toward your first month if you sign up for a monthly bid tier.",
    customer: "A business that wants a written readiness scorecard and a ready or not-yet verdict before bidding.",
    deliverables: [
      "A written scorecard covering registrations (SAM.gov/UEI, Texas CMBL), NAICS and certification fit, capability statement and past performance, insurance and bonding, and pricing readiness.",
      "A 30-minute review call.",
      "A ready / not-yet verdict and a fix-it list.",
    ],
    limitations: [
      "Credited toward the first month of a monthly bid tier. It is not itself a monthly bid subscription.",
      credited,
      noGuarantee,
      checkoutOff,
    ],
    delivery: writtenSchedule,
    customerResponsibilities: [
      "Provide the registration, capability, past-performance, insurance, bonding, and pricing information the scorecard covers.",
    ],
    upgrade: "Credited toward your first month if you sign up for a monthly bid tier.",
    consultationType: "qualified_30",
  },
  {
    id: "quick-bid-review",
    name: "Quick Bid Review",
    price: "$249",
    priceNote: "One solicitation. A paid written review, not a charge for the free introductory call.",
    customer: "A business that already has one solicitation and wants a documented bid or no-bid recommendation.",
    deliverables: [
      "Review of one solicitation you provide, up to 50 pages.",
      "A written bid or no-bid recommendation with the reasons.",
      "A short list of obvious gaps.",
    ],
    limitations: [
      "Covers one solicitation, up to 50 pages.",
      "The price is for the written review, not for the free introductory call.",
      noGuarantee,
      checkoutOff,
    ],
    delivery: writtenSchedule,
    customerResponsibilities: [
      "Provide one solicitation of up to 50 pages.",
    ],
    upgrade: credited,
    consultationType: "quick_bid_preview_30",
  },
  {
    id: "sam-registration-prep",
    name: "SAM.gov Registration Prep",
    price: "$349",
    priceNote: "SAM.gov is free from the government. This fee is for ASBS's preparation help.",
    customer: "A business preparing its own SAM.gov registration and wanting a checklist and a review before it submits.",
    deliverables: [
      "A SAM.gov preparation checklist.",
      "Review of the information you prepare before you submit.",
      "A NAICS code worksheet for you to confirm.",
    ],
    limitations: [
      agencyFees,
      "You submit your own registration and remain the owner of the government account.",
      ownsAccounts,
      noGuarantee,
      checkoutOff,
    ],
    delivery: writtenSchedule,
    customerResponsibilities: [
      "Prepare the SAM.gov information and submit the registration in your own name.",
      "Confirm the NAICS codes on the worksheet.",
    ],
    upgrade: "Registration Bundle or Contractor Launch.",
    consultationType: "qualified_30",
  },
  {
    id: "registration-bundle",
    name: "Registration Bundle",
    price: "$599",
    priceNote: "SAM.gov plus Texas CMBL plus one city or agency vendor portal.",
    customer: "A business preparing SAM.gov, Texas CMBL, and one city or agency vendor portal.",
    deliverables: [
      "Everything in SAM.gov Registration Prep.",
      "Texas CMBL preparation checklist and review.",
      "Preparation checklist and review for one city or agency portal you choose.",
      "A NAICS and NIGP worksheet.",
    ],
    limitations: [
      "Covers one city or agency portal in addition to SAM.gov and Texas CMBL.",
      agencyFees,
      "You submit your own registrations and remain the owner of every government account.",
      ownsAccounts,
      noGuarantee,
      checkoutOff,
    ],
    delivery: writtenSchedule,
    customerResponsibilities: [
      "Choose the one city or agency portal.",
      "Prepare and submit each registration in your own name.",
      "Confirm the NAICS and NIGP codes on the worksheet.",
    ],
    upgrade: "Contractor Launch.",
    consultationType: "qualified_30",
  },
  {
    id: "certification-support",
    name: "Certification support",
    price: "$599 each",
    priceNote: "Per certification application, for example Texas HUB, VetCert, WOSB, or a local program. You submit; approval is decided by the agency.",
    customer: "A business preparing one certification application and wanting an eligibility checklist and a review before it submits.",
    deliverables: [
      "Eligibility and document checklist.",
      "Review of the application you prepare before you submit.",
    ],
    limitations: [
      "Priced per certification application.",
      "You submit. The agency decides approval.",
      ownsAccounts,
      noGuarantee,
      checkoutOff,
    ],
    delivery: writtenSchedule,
    customerResponsibilities: [
      "Prepare the application and submit it in your own name.",
      "Provide the documents the checklist names.",
    ],
    upgrade: credited,
    consultationType: "qualified_30",
  },
  {
    id: "contractor-launch",
    name: "Contractor Launch",
    price: "$999",
    priceNote: "Registrations, capability statement, and assessment in one package. Credited toward your first month if you sign up for a monthly bid tier.",
    customer: "A business that wants the readiness assessment, the registration bundle, and a capability statement draft together.",
    deliverables: [
      "Bid Readiness Assessment.",
      "Registration Bundle (SAM.gov, Texas CMBL, one city or agency portal).",
      "A capability statement draft for you to approve.",
    ],
    limitations: [
      "Credited toward the first month of a monthly bid tier.",
      credited,
      agencyFees,
      "You submit your own registrations and approve the capability statement.",
      ownsAccounts,
      noGuarantee,
      checkoutOff,
    ],
    delivery: writtenSchedule,
    customerResponsibilities: [
      "Provide the information the assessment and registration checklists need.",
      "Submit registrations in your own name.",
      "Approve the capability statement draft.",
    ],
    upgrade: "Credited toward your first month if you sign up for a monthly bid tier.",
    consultationType: "onboarding_45",
  },
  {
    id: "monitor",
    name: "Monitor",
    price: "$350/month",
    priceNote: "Opportunity monitoring only; no bids.",
    customer: "A business that wants matched opportunities and deadline alerts without bid preparation.",
    deliverables: [
      "Weekly matched opportunities.",
      "Deadline alerts.",
    ],
    limitations: [
      "Opportunity monitoring only. No bids are prepared.",
      ...monthlyLimitations,
    ],
    delivery: "A monthly cycle after the written agreement. Three-month minimum, then month-to-month.",
    customerResponsibilities: [
      "Name the work you want matched.",
      "You still make every bid or no-bid decision.",
    ],
    upgrade: "Starter Bid, Growth, or Full Capture.",
    consultationType: "onboarding_45",
  },
  {
    id: "starter-bid",
    name: "Starter Bid",
    price: "$1,000/month",
    priceNote: "For businesses bidding a few times a month.",
    customer: "A business that wants monitoring plus up to three prepared bids each month.",
    deliverables: [
      "Everything in Monitor.",
      "Up to 3 bids prepared each month.",
    ],
    limitations: monthlyLimitations,
    delivery: "A monthly cycle after the written agreement. Three-month minimum, then month-to-month.",
    customerResponsibilities: [
      "Approve pricing.",
      "Make every bid or no-bid decision.",
      "Sign and submit in your own name.",
    ],
    upgrade: "Growth or Full Capture. Extra bids are $300 each.",
    consultationType: "onboarding_45",
  },
  {
    id: "growth",
    name: "Growth",
    price: "$1,800/month",
    priceNote: "For businesses bidding regularly.",
    customer: "A business that wants monitoring, up to six prepared bids each month, and pricing support.",
    deliverables: [
      "Everything in Monitor.",
      "Up to 6 bids prepared each month.",
      "Pricing support.",
    ],
    limitations: monthlyLimitations,
    delivery: "A monthly cycle after the written agreement. Three-month minimum, then month-to-month.",
    customerResponsibilities: [
      "Approve pricing.",
      "Make every bid or no-bid decision.",
      "Sign and submit in your own name.",
    ],
    upgrade: "Full Capture. Extra bids are $300 each.",
    consultationType: "onboarding_45",
  },
  {
    id: "full-capture",
    name: "Full Capture",
    price: "$2,800/month",
    priceNote: "For businesses building a steady government pipeline.",
    customer: "A business that wants monitoring, up to ten prepared bids each month, registration upkeep, and a quarterly pipeline review.",
    deliverables: [
      "Everything in Monitor.",
      "Up to 10 bids prepared each month.",
      "Registration upkeep.",
      "A quarterly pipeline review.",
    ],
    limitations: monthlyLimitations,
    delivery: "A monthly cycle after the written agreement. Three-month minimum, then month-to-month.",
    customerResponsibilities: [
      "Approve pricing.",
      "Make every bid or no-bid decision.",
      "Sign and submit in your own name.",
      "Keep the information used for registration upkeep accurate.",
    ],
    upgrade: "Extra bids beyond the tier are $300 each.",
    consultationType: "onboarding_45",
  },
];

export function packageById(id) {
  return PACKAGES.find((item) => item.id === id) || null;
}
