// Third Wave BBQ — Brand Knowledge Base
// This file is loaded into every response generation prompt.
// Update it as your business details change.

export const TWB_KNOWLEDGE = {

  brand: {
    name: "Third Wave BBQ",
    tagline: "Australian experiential BBQ dining",
    founded: 2010,
    description: "Third Wave BBQ is Australia's premier American-style BBQ restaurant brand, known for low-and-slow smoked meats, an immersive dining experience, and a massive social media presence.",
    socialReach: "200M+ monthly views across platforms",
    handles: {
      instagram: "@thirdwavebbq",
      facebook: "@thirdwavebbq",
      tiktok: "TBC",
      youtube: "TBC",
      twitter: "TBC",
    },
  },

  venues: [
    {
      name: "Albert Park",
      suburb: "Albert Park",
      city: "Melbourne",
      state: "VIC",
      type: "corporate",
      status: "open",
      bookings: true,
    },
    {
      name: "Hawthorn",
      suburb: "Hawthorn",
      city: "Melbourne",
      state: "VIC",
      type: "corporate",
      status: "open",
      bookings: true,
    },
    {
      name: "Moorabbin",
      suburb: "Moorabbin",
      city: "Melbourne",
      state: "VIC",
      type: "corporate",
      status: "open",
      bookings: true,
    },
    {
      name: "Ascot Vale",
      suburb: "Ascot Vale",
      city: "Melbourne",
      state: "VIC",
      type: "corporate",
      status: "opening_soon",
      bookings: false,
    },
  ],

  menu: {
    signature: [
      "Smoked brisket",
      "Beef ribs",
      "Pulled pork",
      "Smoked chicken",
      "Pork ribs",
      "Burnt ends",
    ],
    sides: [
      "Mac and cheese",
      "Coleslaw",
      "Cornbread",
      "Baked beans",
      "Pickles and onions",
    ],
    specials: [
      "All You Can Eat Tuesdays (AYCE Tuesdays)",
    ],
    dietaryNotes: "Menu items may contain allergens. Guests with dietary requirements should speak to staff on arrival. Limited vegetarian options available.",
  },

  bookings: {
    method: "Online via website or phone",
    groupNote: "Large group bookings (10+) require advance notice",
    websiteNote: "Direct guests to the website or Google search for current booking links — do not hardcode URLs as they may change",
  },

  offers: {
    birthday: "Birthday voucher available — guests should sign up via the website",
    loyalty: "No formal loyalty program currently",
  },

  franchising: {
    available: true,
    territories: "Multiple Australian territories available. Melbourne territories are limited.",
    inquiryNote: "Direct all franchise inquiries to the business team — do not discuss fees or financials in public comments",
  },

  commonFAQs: [
    {
      question: "Do you take bookings / reservations?",
      answer: "Yes! All three of our Melbourne venues (Albert Park, Hawthorn, and Moorabbin) take bookings. Head to our website or search us on Google to book your table.",
    },
    {
      question: "What are your opening hours?",
      answer: "Opening hours vary by venue. The most up-to-date hours are on our Google listings and website. We recommend checking before you visit.",
    },
    {
      question: "Do you have an All You Can Eat option?",
      answer: "Yes! We run All You Can Eat Tuesdays at our venues. Keep an eye on our socials for details and any updates.",
    },
    {
      question: "Do you cater for large groups / events?",
      answer: "Absolutely — we love a big group! Reach out directly to your nearest venue to discuss group bookings and event packages.",
    },
    {
      question: "Do you cater for vegetarians / vegans?",
      answer: "We're primarily a BBQ joint, but we do have some options. Best to contact the venue directly to discuss what's available on the day.",
    },
    {
      question: "Do you deliver / do takeaway?",
      answer: "Delivery and takeaway availability varies by venue. Check our website or Google listing for your nearest venue to see current options.",
    },
    {
      question: "Are you opening in [location]?",
      answer: "We're actively expanding! We can't always share specific timelines publicly, but follow us to stay up to date on new venue announcements.",
    },
    {
      question: "How do I get a birthday voucher?",
      answer: "Sign up through our website to get on the birthday list — we send out vouchers to our database around your birthday.",
    },
    {
      question: "Is franchising available?",
      answer: "Yes, we are actively franchising across Australia! Send us a DM or visit our website for more information on available territories.",
    },
    {
      question: "Compliment / this looks amazing",
      answer: "Thanks so much! We love hearing that — come visit us soon! 🔥",
    },
  ],

  brandVoice: {
    tone: "Warm, confident, and genuine. We're passionate about BBQ and love our community. Not overly corporate — conversational and real.",
    doUse: [
      "Friendly, genuine enthusiasm",
      "BBQ/fire/smoke metaphors where natural",
      "Direct answers — don't waffle",
      "First-person plural (we, our, us)",
      "Light emoji use (🔥 🍖 👊) — sparingly, not on every message",
    ],
    doNotUse: [
      "Overly formal language",
      "Generic 'thanks for your feedback' corporate speak",
      "Promises we can't keep (e.g. 'we'll fix this immediately')",
      "Specific prices or menu details that might change",
      "Specific URLs that might change",
      "Anything that admits legal liability",
      "Responding to media/press in comments — always DM or escalate",
    ],
    signOff: "— The TWB Team",
    maxLength: "Keep responses under 3 sentences for comments. DMs can be slightly longer but still concise.",
  },

  escalationRules: {
    autoEscalate: [
      "Complaint about food quality, foreign object, or contamination",
      "Any mention of illness, food poisoning, or injury",
      "Request for refund or compensation",
      "Angry or aggressive tone with specific complaint",
      "Negative review with 1-2 star experience described",
      "Any mention of media, press, journalist, news, or TV",
      "Legal threats or mentions of lawyers / consumer affairs",
      "Allegations of discrimination, harassment, or serious misconduct by staff",
      "Any message that seems like a crisis or PR risk",
    ],
    autoHandle: [
      "Booking enquiries (direct to website/Google)",
      "General enthusiasm / compliments",
      "Questions about hours (direct to Google listing)",
      "AYCE Tuesday questions",
      "Franchise interest (direct to DM/website)",
      "New venue / expansion questions",
      "Birthday voucher questions",
      "Group booking enquiries (direct to venue)",
      "Dietary questions (direct to venue)",
    ],
  },

};
