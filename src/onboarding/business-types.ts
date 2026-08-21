/**
 * Official Business Type + Industry labels (UX-21 / DG-05).
 * Canonical product list: loyollo-web/docs/backend/data-contract.md
 * Keep in sync with loyollo-web/src/data/businessTypes.ts — do not import it.
 */

export const BUSINESS_INDUSTRIES = {
  Retail: [
    "Grocery / Supermarket",
    "Convenience store",
    "Pharmacy / Drugstore",
    "Department store",
    "Specialty retail",
    "Electronics / Mobile phone store",
    "Home goods / Furniture",
    "Sporting goods / Outdoors",
    "Books / Stationery",
    "Pet supplies",
  ],
  "Food & Beverage": [
    "Quick-service / Fast food",
    "Casual dining restaurants",
    "Fine dining / Upscale restaurants",
    "Cafés / Coffee shops",
    "Bakeries / Dessert shops",
    "Ice cream / Frozen yogurt",
    "Food trucks / Street food",
    "Bars / Pubs / Nightclubs",
    "Juice / Smoothie bars",
    "Catering services",
  ],
  "Travel & Hospitality": [
    "Hotels / Resorts / B&Bs",
    "Motels / Inns",
    "Hostels",
    "Vacation rentals / Short-term stays",
    "Travel agencies / Tour operators",
    "Car rental / Car services",
    "Airport parking / Limo services",
  ],
  "Health & Wellness": [
    "Pharmacies",
    "Fitness centers / Gyms",
    "Yoga / Pilates studios",
    "Personal trainers",
    "Spas / Massage therapists",
    "Wellness clinics / Naturopathy",
    "Nutritionists / Dietitians",
    "Physical therapy / Rehab clinics",
  ],
  "Beauty & Personal Care": [
    "Hair salons / Barbershops",
    "Nail salons / Manicure & pedicure",
    "Skincare / Estheticians",
    "Cosmetic clinics / Medi-spas",
    "Barber shops",
  ],
  "Home & Services": [
    "Cleaning services (residential/commercial)",
    "Landscaping / Lawn care",
    "Pest control",
    "Plumbing / HVAC / Electrical",
    "Handyman / Home repair",
    "Home improvement / Hardware stores",
    "Interior design / Decorators",
    "Appliance repair",
  ],
  "Professional Services": [
    "Accounting / Bookkeeping",
    "Legal / Law firms",
    "Financial advisors / Wealth managers",
    "Insurance brokers",
    "Real estate agents / Brokers",
    "Marketing / Advertising agencies",
    "IT / Managed services",
    "Consulting (business/management)",
  ],
  "Entertainment & Leisure": [
    "Movie theaters / Cinema",
    "Live events / Concert venues",
    "Escape rooms / Interactive experiences",
    "Museums / Galleries",
    "Amusement parks / Arcades",
    "Sports venues / Clubs",
    "Bowling / Billiards",
  ],
  "Education & Childcare": [
    "Daycare / Childcare centers",
    "Tutoring / Test prep",
    "Music / Art / Dance schools",
    "Language schools",
    "Professional training / Workshops",
  ],
  Automotive: [
    "Auto repair / Service shops",
    "Car wash / Detailing",
    "Tire shops / Alignment",
    "Auto parts stores",
    "Vehicle sales / Dealers",
  ],
  "Financial & Payment": [
    "Banks / Credit unions",
    "Payment processors / Fintech partners",
    "Money transfer services",
    "Insurance providers",
  ],
  "Telecom & Utilities": [
    "Mobile carriers / Retailers",
    "Internet service providers",
    "Utility companies",
  ],
  "Gifts, Experiences & Specialty": [
    "Florists",
    "Gift shops / Card stores",
    "Jewelry stores",
    "Photo studios / Printing services",
    "Event planners / Wedding services",
    "Photography / Videography",
  ],
  "B2B & Wholesale": [
    "Office supplies / Stationery wholesale",
    "Commercial suppliers / Distributors",
    "Co-working spaces / Business centers",
  ],
  "Nonprofit & Community": [
    "Charities / Fundraising partners",
    "Community centers / Clubs",
    "Religious organizations",
  ],
  "Digital & Subscriptions": [
    "Streaming services / Media subscriptions",
    "SaaS / Software subscriptions",
    "Online education platforms",
    "E-commerce marketplaces",
  ],
  "Logistics & Delivery": [
    "Courier / Same-day delivery",
    "Food delivery platforms",
    "Last-mile fulfillment",
  ],
  Others: [
    "Tattoo & piercing studios",
    "Dry cleaning / Laundry",
    "Tailors / Alterations",
    "Vending services",
    "Farmers' markets / Local artisans",
  ],
} as const satisfies Record<string, readonly string[]>;

export type BusinessCategory = keyof typeof BUSINESS_INDUSTRIES;

export const BUSINESS_CATEGORIES = Object.keys(BUSINESS_INDUSTRIES) as BusinessCategory[];

export const PLANS = ["starter", "growth", "premium"] as const;
export type Plan = (typeof PLANS)[number];

export function isBusinessCategory(value: string): value is BusinessCategory {
  return Object.hasOwn(BUSINESS_INDUSTRIES, value);
}

export function isIndustryOf(category: string, industry: string): boolean {
  if (!isBusinessCategory(category)) return false;
  return (BUSINESS_INDUSTRIES[category] as readonly string[]).includes(industry);
}
