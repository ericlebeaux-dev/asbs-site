import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const STAGES = [
  "new_lead",
  "qualified",
  "consultation_scheduled",
  "consultation_completed",
  "proposal_sent",
  "won",
  "lost",
  "active_client",
  "completed",
  "follow_up",
];

const EMPTY = { leads: [], bookings: [], events: [], documents: [] };

export function createStore(dataDir) {
  const dir = path.resolve(dataDir);
  const file = path.join(dir, "store.json");
  const uploadDir = path.join(dir, "uploads");
  fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(EMPTY), { mode: 0o600 });

  let chain = Promise.resolve();
  function locked(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(() => {}, () => {});
    return run;
  }

  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return {
        leads: parsed.leads || [],
        bookings: parsed.bookings || [],
        events: parsed.events || [],
        documents: parsed.documents || [],
      };
    } catch {
      return structuredClone(EMPTY);
    }
  }

  function write(data) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  function tokenHash(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  return {
    locked,
    read,
    /** One store transaction. Do not call other store methods from inside `fn`. */
    transact(fn) {
      return locked(() => fn({ read, write, tokenHash }));
    },
    activeBusy() {
      return read().bookings
        .filter((booking) => booking.status === "scheduled")
        .map((booking) => ({ start: new Date(booking.start), end: new Date(booking.end), id: booking.id }));
    },
    saveDocument(meta, bytes) {
      return locked(async () => {
        const data = read();
        const lead = data.leads.find((item) => item.id === meta.leadId);
        if (!lead) {
          const error = new Error("The registration could not be found.");
          error.status = 404;
          throw error;
        }
        const existing = data.documents.filter((item) => item.leadId === meta.leadId);
        if (existing.length >= 5) {
          const error = new Error("This registration already has the maximum of 5 private documents.");
          error.status = 400;
          throw error;
        }
        const id = crypto.randomUUID();
        const filename = `${id}.${meta.extension}`;
        fs.writeFileSync(path.join(uploadDir, filename), bytes, { mode: 0o600 });
        const record = {
          id,
          leadId: meta.leadId,
          filename: meta.filename,
          storedName: filename,
          mimeType: meta.mimeType,
          size: bytes.length,
          createdAt: new Date().toISOString(),
        };
        data.documents.push(record);
        write(data);
        return record;
      });
    },
    getDocument(id) {
      const data = read();
      const record = data.documents.find((item) => item.id === id);
      if (!record) return null;
      const full = path.join(uploadDir, record.storedName);
      if (!full.startsWith(uploadDir)) return null;
      return { record, bytes: fs.readFileSync(full) };
    },
    createCustomerLead(fields, { stage = "new_lead", followUp = null } = {}) {
      return locked(async () => {
        const data = read();
        const now = new Date().toISOString();
        const existing = data.leads.find((lead) => lead.role === "customer" && lead.email === fields.email);
        if (existing) {
          const history = {
            at: now,
            summary: "Updated from a new website submission. The existing record was kept.",
          };
          existing.submissions = existing.submissions || [];
          existing.submissions.push({ at: now, serviceInterest: fields.serviceInterest || existing.serviceInterest || "" });
          existing.notes = existing.notes || [];
          existing.notes.push({ id: crypto.randomUUID(), at: now, author: "system", text: history.summary });
          existing.updatedAt = now;
          existing.name = fields.name || existing.name;
          existing.phone = fields.phone || existing.phone;
          existing.organization = fields.organization || existing.organization;
          existing.serviceInterest = fields.serviceInterest || existing.serviceInterest;
          existing.packageId = fields.packageId || existing.packageId;
          existing.leadSource = existing.leadSource || fields.leadSource || "website";
          existing.intake = { ...(existing.intake || {}), ...fields };
          if (followUp && !existing.followUpAt) existing.followUpAt = followUp;
          if (stage === "new_lead" && ["follow_up", "lost", "completed"].includes(existing.stage)) {
            existing.stage = "new_lead";
          } else if (stageRank(stage) > stageRank(existing.stage)) existing.stage = stage;
          write(data);
          return { lead: existing, duplicate: true };
        }
        const lead = {
          id: crypto.randomUUID(),
          role: "customer",
          stage,
          name: fields.name,
          organization: fields.organization,
          email: fields.email,
          phone: fields.phone,
          serviceInterest: fields.serviceInterest || "",
          packageId: fields.packageId || "",
          leadSource: fields.leadSource || "website",
          estimatedValueCents: null,
          paymentStatus: "not_collected",
          amountVerified: false,
          followUpAt: followUp,
          intake: fields,
          notes: [{ id: crypto.randomUUID(), at: now, author: "system", text: "Created from the website." }],
          submissions: [{ at: now, serviceInterest: fields.serviceInterest || "" }],
          createdAt: now,
          updatedAt: now,
        };
        data.leads.push(lead);
        write(data);
        return { lead, duplicate: false };
      });
    },
    createVendorLead(fields) {
      return locked(async () => {
        const data = read();
        const now = new Date().toISOString();
        const existing = data.leads.find((lead) => lead.role === "vendor" && lead.email === fields.email);
        if (existing) {
          existing.updatedAt = now;
          existing.intake = { ...(existing.intake || {}), ...fields };
          existing.name = fields.name;
          existing.organization = fields.organization;
          existing.phone = fields.phone;
          existing.notes.push({
            id: crypto.randomUUID(),
            at: now,
            author: "system",
            text: "Vendor registration was submitted again. The existing private record was updated.",
          });
          write(data);
          return { lead: existing, duplicate: true };
        }
        const lead = {
          id: crypto.randomUUID(),
          role: "vendor",
          stage: "new_lead",
          name: fields.name,
          organization: fields.legalName,
          email: fields.email,
          phone: fields.phone,
          serviceInterest: "vendor-teaming",
          packageId: "",
          leadSource: "website",
          estimatedValueCents: null,
          paymentStatus: "not_applicable",
          amountVerified: false,
          followUpAt: null,
          intake: fields,
          notes: [{ id: crypto.randomUUID(), at: now, author: "system", text: "Vendor registration received. Not a promise of work." }],
          submissions: [{ at: now, serviceInterest: "vendor-teaming" }],
          createdAt: now,
          updatedAt: now,
        };
        data.leads.push(lead);
        write(data);
        return { lead, duplicate: false };
      });
    },
    attachBooking(leadId, booking) {
      return locked(async () => {
        const data = read();
        const lead = data.leads.find((item) => item.id === leadId);
        if (!lead) {
          const error = new Error("Customer record was not found.");
          error.status = 500;
          throw error;
        }
        data.bookings.push(booking);
        lead.stage = "consultation_scheduled";
        lead.consultation = {
          bookingId: booking.id,
          type: booking.type,
          start: booking.start,
          end: booking.end,
          meetingMode: booking.meetingMode,
          calendarEventId: booking.calendarEventId || null,
        };
        lead.updatedAt = new Date().toISOString();
        lead.followUpAt = booking.start;
        lead.notes.push({
          id: crypto.randomUUID(),
          at: lead.updatedAt,
          author: "system",
          text: `Consultation scheduled for ${booking.start}.`,
        });
        write(data);
        return booking;
      });
    },
    findBooking(id) {
      return read().bookings.find((booking) => booking.id === id) || null;
    },
    tokenMatches(booking, token) {
      if (!booking || !token) return false;
      const a = Buffer.from(tokenHash(token));
      const b = Buffer.from(booking.tokenHash);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },
    updateBooking(id, patch) {
      return locked(async () => {
        const data = read();
        const booking = data.bookings.find((item) => item.id === id);
        if (!booking) return null;
        Object.assign(booking, patch, { updatedAt: new Date().toISOString() });
        const lead = data.leads.find((item) => item.id === booking.leadId);
        if (lead && lead.consultation) {
          lead.consultation = { ...lead.consultation, ...patch, bookingId: booking.id };
          lead.updatedAt = booking.updatedAt;
          if (patch.status === "cancelled") {
            lead.stage = "follow_up";
            lead.followUpAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            lead.notes.push({
              id: crypto.randomUUID(),
              at: booking.updatedAt,
              author: "system",
              text: "The customer cancelled this consultation from the confirmation page.",
            });
          }
        }
        write(data);
        return booking;
      });
    },
    updateLead(id, patch, note) {
      return locked(async () => {
        const data = read();
        const lead = data.leads.find((item) => item.id === id);
        if (!lead) return null;
        const now = new Date().toISOString();
        if (patch.stage) {
          if (!STAGES.includes(patch.stage)) {
            const error = new Error("Unknown pipeline stage.");
            error.status = 400;
            throw error;
          }
          lead.stage = patch.stage;
        }
        if ("followUpAt" in patch) lead.followUpAt = patch.followUpAt || null;
        if ("estimatedValueCents" in patch) {
          lead.estimatedValueCents = patch.estimatedValueCents == null ? null : Number(patch.estimatedValueCents);
        }
        if (patch.packageId) lead.packageId = patch.packageId;
        if (patch.payment) {
          if (patch.payment.attestation !== "collected") {
            const error = new Error("A payment can be recorded only when the owner attests that it was actually collected.");
            error.status = 400;
            throw error;
          }
          const amount = Number(patch.payment.amountCents);
          if (!Number.isInteger(amount) || amount < 0 || amount > 100_000_000) {
            const error = new Error("Enter the collected amount in cents.");
            error.status = 400;
            throw error;
          }
          lead.paymentStatus = "paid";
          lead.amountVerified = true;
          lead.collectedAmountCents = amount;
          lead.collectedOn = patch.payment.receivedOn || now.slice(0, 10);
          lead.paymentSource = "owner_attested";
          lead.notes.push({
            id: crypto.randomUUID(),
            at: now,
            author: "owner",
            text: `Owner attested collected payment of ${amount} cents on ${lead.collectedOn}. This did not come from Stripe.`,
          });
        }
        if (note) lead.notes.push({ id: crypto.randomUUID(), at: now, author: "owner", text: note });
        lead.updatedAt = now;
        write(data);
        return publicLead(lead);
      });
    },
    addEvent(event) {
      return locked(async () => {
        const data = read();
        data.events.push(event);
        if (data.events.length > 5000) data.events.splice(0, data.events.length - 5000);
        write(data);
      });
    },
    snapshot() {
      const data = read();
      return {
        leads: data.leads.map(publicLead),
        bookings: data.bookings.map(publicBooking),
        events: data.events,
        documents: data.documents.map(({ id, leadId, filename, mimeType, size, createdAt }) => ({
          id, leadId, filename, mimeType, size, createdAt,
        })),
      };
    },
  };
}

function stageRank(stage) {
  const rank = STAGES.indexOf(stage);
  return rank === -1 ? 0 : rank;
}

function publicLead(lead) {
  return {
    id: lead.id,
    role: lead.role,
    stage: lead.stage,
    name: lead.name,
    organization: lead.organization,
    email: lead.email,
    phone: lead.phone,
    serviceInterest: lead.serviceInterest,
    packageId: lead.packageId,
    leadSource: lead.leadSource,
    estimatedValueCents: lead.estimatedValueCents,
    paymentStatus: lead.paymentStatus,
    amountVerified: lead.amountVerified === true,
    collectedAmountCents: lead.amountVerified ? lead.collectedAmountCents : null,
    paymentSource: lead.paymentSource || null,
    followUpAt: lead.followUpAt,
    consultation: lead.consultation || null,
    intake: lead.intake || {},
    notes: lead.notes || [],
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
  };
}

function publicBooking(booking) {
  const { tokenHash, ...rest } = booking;
  return rest;
}
