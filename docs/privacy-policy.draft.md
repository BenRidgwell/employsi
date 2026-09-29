# Employsi — Privacy Policy

**DRAFT for review. Not legal advice.** Every factual claim below was checked
against this repository on 2026-09-29 and the places it was read from are noted
in `docs/privacy-policy.notes.md`. The parts that need a decision from you, not
from the code, are marked **[CONFIRM]**.

**Last updated:** [CONFIRM: date you publish]
**Effective:** [CONFIRM: date you publish]

---

## 1. Who we are

Employsi is a labour-market intelligence service. It presents job-vacancy and
skill-demand data on an interactive map, drawn from employer career pages,
government job boards, job-board APIs and official statistics.

This policy is issued by **[CONFIRM: registered entity name] (ABN [CONFIRM])**
("Employsi", "we", "us"), which is the entity responsible for the personal
information described here.

**Contact:** [CONFIRM: privacy contact email]
**Postal:** [CONFIRM: postal address]

## 2. What this policy covers

- The public site at **employsi.com.au**, which is our waitlist and marketing
  page.
- The Employsi application, served at **/app**.

It does not cover any third-party site you reach by following a link from ours,
including the job advertisements we link out to.

## 3. Information we collect

### 3.1 If you only visit the site

The waitlist page at employsi.com.au collects **no personal information**. It
has no form fields and no sign-up input.

### 3.2 If you use the application without signing in

We record how the product is used, in a deliberately limited form:

| What | Why |
| --- | --- |
| A random per-browser identifier, stored in your browser's local storage | So we can count visitors separately from signed-in users without identifying you |
| A per-visit session identifier | To measure how long a visit lasted and how many actions it contained |
| Product events — that a card was opened, a search was run, a company was followed — with a low-detail label such as a skill name, a city, or a sector | To understand which parts of the product are used |
| Counts of which companies, cities, regions and skills are viewed | These power the public "most viewed" and "what's trending" panels |

**What is deliberately not collected in these records:** your IP address, your
browser's user-agent string, the page URL, the referring site, and — this one
matters — **the text you type into the search box**. We record that a search
happened, never what it said.

### 3.3 If you create an account

Accounts are created only through **Google** or **LinkedIn** sign-in. We do not
offer email-and-password sign-in, so **we never receive, store or process a
password**.

From your chosen provider we receive and store:

- your name;
- your email address;
- whether the provider has verified that address;
- your profile image URL, if the provider supplies one;
- the dates your account was created and last updated.

To keep you signed in we also store a session record containing a session token,
its expiry, **your IP address and your browser's user-agent string**, and access
and refresh tokens issued by the sign-in provider.

> Note the difference from section 3.2: product-usage records hold no IP address,
> but the sign-in session record does. It is kept for the life of the session
> (see section 8) and is used to maintain and secure your sign-in, not for
> analytics.

Your **lower-cased email address** is the identifier that links your account to
anything you contribute in the product — feedback posts, recorded market
interest, and your product-usage events.

### 3.4 If you ask the AI analyst a question

The application includes an "Ask an analyst" feature. **The question you type is
sent to Anthropic**, which operates the language model that drafts the reply.
Please do not type anything into it you would not want sent to a third-party
provider.

To stop the feature being abused we count how many questions come from each
visitor each day. We do this using a **keyed one-way hash of your IP address**,
computed under a secret held only on our server and re-keyed each day; the IP
address itself is not stored in those counting records, and the stored value
cannot be turned back into an address by anyone who obtains it.

## 4. Cookies and browser storage

| Item | Type | Purpose | Lifetime |
| --- | --- | --- | --- |
| Sign-in session cookie | Cookie (HTTP-only, Secure, SameSite=Lax) | Keeps you signed in | Up to 30 days, extended while you keep using the app |
| `employsi.anon` | Local storage | The random per-browser identifier in section 3.2 | Until you clear site data |
| Interface preferences (e.g. a remembered tab or filter) | Local storage | Remembers small display choices | Until you clear site data |

We do not use advertising cookies, and we do not embed third-party advertising or
social tracking pixels.

**[CONFIRM]** Whether you wish to add a cookie consent banner. Our view is that
the sign-in cookie is strictly necessary and the local-storage items are not
cross-site tracking, but if you intend to market into the EU or UK you should
take advice on this.

## 5. How we use information

- To operate the map, the cards and the search.
- To keep you signed in and to secure your account.
- To produce the public "most viewed" and "what's trending" panels, which are
  aggregate counts and do not name individuals.
- To understand product usage in aggregate, through an internal administrator
  view.
- To answer questions you put to the AI analyst.
- To respond to you if you contact us.

We do **not** sell personal information, and we do not use it to build
advertising profiles.

## 6. Information about people who are not our users

This is unusual enough to state plainly.

### 6.1 Job advertisements

We archive job advertisements from employer career pages, government job boards
and job-board APIs. For each advertisement we keep the job title, the employer
name, the location, the stated salary if any, the listing link, the dates it was
seen, and the skills our classifier matched to the title.

We do **not** store advertisement body text, and we do not store recruiter or
contact names from advertisements.

### 6.2 Career-movement data ("talent flows")

To show how people move between employers, we analyse publicly visible
professional-profile data obtained through a third-party data provider.

**This data is pseudonymised at the point of collection.** A profile is reduced
to a one-way keyed hash, and the only things kept against that hash are:

- the employer moved **from** and the employer moved **to**, by company name;
- the month of the move;
- the skills our classifier matched to the new role.

We do **not** store names, job titles, profile URLs, photographs, contact
details, or any free text from these profiles. The product displays only
aggregate company-to-company flows, never an individual.

**[CONFIRM — please get advice on this section.]** Pseudonymised data derived
from identifiable source records may still be personal information under the
Privacy Act 1988 (Cth) and equivalent laws, and the collection of it may engage
notification obligations (APP 5) that are impractical to meet for people we never
contact. This is the highest-risk part of the product from a privacy standpoint
and the design choices above reduce that risk but do not remove it.

## 7. Who we share information with

We use the following service providers, who process information on our behalf:

| Provider | What it does | What it sees |
| --- | --- | --- |
| **Cloudflare** | Hosting, application database, key-value storage | All application data; request metadata including IP address |
| **Google** / **LinkedIn** | Sign-in | Your identity with them, at the point you choose to sign in |
| **Mapbox** | Map tiles and geocoding | Your browser's requests for map data, including IP address, as you pan and zoom |
| **Anthropic** | The AI analyst's language model | The question you type into "Ask an analyst" |
| **[CONFIRM: your data provider(s)]** | Collection of the public data in section 6 | No information about Employsi users |

We may also disclose information where we are required to by law, or to protect
our rights or the safety of others.

## 8. Where information is stored, and for how long

Our providers operate globally, and information is stored and processed
**outside Australia** — including in the United States. By using Employsi you
acknowledge that your information may be handled overseas, where privacy
protections may differ from Australian law. We take reasonable steps to use
reputable providers with appropriate safeguards.

**[CONFIRM: retention periods.]** The code does not currently define retention
limits for most records, so these need to be decided rather than described:

| Data | Current behaviour | **[CONFIRM] intended retention** |
| --- | --- | --- |
| Sign-in sessions | Expire after 30 days of inactivity | — |
| AI-analyst daily counts | Kept per day, indefinitely | — |
| Product-usage events | Kept indefinitely | — |
| Account records | Kept until the account is deleted | — |
| Job advertisement archive | Kept indefinitely (it is a historical series) | — |
| Career-movement data | Kept indefinitely | — |

## 9. Security

- Sign-in is delegated to Google and LinkedIn; **no passwords exist in our
  database to be stolen.**
- Session cookies are HTTP-only, Secure and SameSite=Lax.
- Career-movement data is pseudonymised before storage (section 6.2).
- All traffic is served over HTTPS.

No system is completely secure. If we become aware of a data breach likely to
cause serious harm, we will notify affected individuals and the Office of the
Australian Information Commissioner as required by the Notifiable Data Breaches
scheme.

## 10. Your rights

You may ask us to:

- **give you access** to the personal information we hold about you;
- **correct** it if it is wrong;
- **delete** your account and the personal information attached to it;
- **stop** using your information for product analytics.

Write to [CONFIRM: privacy contact email]. We will respond within 30 days.

Because career-movement data is pseudonymised with a one-way hash (section 6.2),
we generally **cannot** locate an individual within it on request — there is no
key that maps a person to their hash. We can explain the method and, where you
identify the source profile, prevent future collection. **[CONFIRM: confirm this
position with your adviser.]**

If you are unhappy with our response you may complain to the Office of the
Australian Information Commissioner (oaic.gov.au). Users in New Zealand may
contact the Office of the Privacy Commissioner (privacy.org.nz).

## 11. Children

Employsi is not intended for people under 16 and we do not knowingly collect
their personal information.

## 12. Changes

We will post any change to this policy on this page and update the date above.
If a change materially affects how we handle your personal information, we will
tell account holders by email.

## 13. Contact

[CONFIRM: registered entity name]
[CONFIRM: postal address]
[CONFIRM: privacy contact email]
