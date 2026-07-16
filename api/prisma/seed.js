import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { MEDIA_GROUPS, CHANNEL_MASTERS } from './channel-seed-data.js';
import { CLIENTS } from './client-seed-data.js';

const prisma = new PrismaClient();

// Single "total" bucket per non-TV/Radio forecasting category — see
// listForecastChannels (api/src/controllers/forecasting.controller.js) and the
// zero-usage channel reconcile below, both of which depend on these exact names.
const TOTAL_BUCKETS = [
  // Per-medium "total" bucket channels. Every medium has one so the forecast
  // entry form can offer a "Total only" mode (a single lump-sum input) as an
  // alternative to per-channel entry — see listForecastChannels.
  { name: 'TV Total', medium: 'TV', sortOrder: 99 },
  { name: 'Radio Total', medium: 'RADIO', sortOrder: 199 },
  { name: 'Print', medium: 'PRINT', sortOrder: 201 },
  { name: 'Cinema', medium: 'CINEMA', sortOrder: 301 },
  { name: 'OOH', medium: 'OOH', sortOrder: 401 },
  { name: 'Digital', medium: 'DIGITAL', sortOrder: 501 },
];

async function main() {
  console.log('Seeding database...');

  // ── Admin user ──────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('Shehan@98', 12);

  const superAdmin = await prisma.user.upsert({
    where: { email: 'shehan.kavishka@ogilvy.com' },
    update: {},
    create: {
      email: 'shehan.kavishka@ogilvy.com',
      passwordHash,
      name: 'Shehan Kavishka',
      role: 'SUPER_ADMIN',
      mustChangePassword: false,
    },
  });

  console.log(`Super admin created/found: ${superAdmin.email} (id: ${superAdmin.id})`);

  // ── Agencies ────────────────────────────────────────────────────────────────
  const agencyNames = ['RedWorks Media', 'Ogilvy Media', 'Geometry Media'];
  const agencies = [];

  for (const name of agencyNames) {
    const agency = await prisma.agency.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    agencies.push(agency);
    console.log(`Agency created/found: ${agency.name} (id: ${agency.id})`);
  }

  // Assign super admin to all agencies
  for (const agency of agencies) {
    await prisma.userAgencyAccess.upsert({
      where: {
        userId_agencyId: {
          userId: superAdmin.id,
          agencyId: agency.id,
        },
      },
      update: {},
      create: {
        userId: superAdmin.id,
        agencyId: agency.id,
      },
    });
    console.log(`Assigned ${superAdmin.name} to ${agency.name}`);
  }

  // ── Media Groups ────────────────────────────────────────────────────────────
  console.log('\nSeeding media groups...');

  const mediaGroupNames = MEDIA_GROUPS;
  const mediaGroupMap = {};

  for (const name of mediaGroupNames) {
    const group = await prisma.mediaGroup.upsert({
      where: { name },
      update: { active: true },
      create: {
        name,
        active: true,
        createdById: superAdmin.id,
      },
    });
    mediaGroupMap[name] = group;
  }
  console.log(`Media groups upserted: ${mediaGroupNames.length}`);

  // ── Channel Masters ─────────────────────────────────────────────────────────
  console.log('\nSeeding channel masters...');

  const channelMasterData = CHANNEL_MASTERS;

  for (const ch of channelMasterData) {
    const mediaGroup = mediaGroupMap[ch.mediaGroup];
    if (!mediaGroup) {
      throw new Error(`Media group not found for channel: ${ch.name} (group: ${ch.mediaGroup})`);
    }

    await prisma.channelMaster.upsert({
      where: { name: ch.name },
      update: {
        medium: ch.medium,
        mediaGroupId: mediaGroup.id,
        isActive: true,
      },
      create: {
        name: ch.name,
        medium: ch.medium,
        aliases: [],
        isActive: true,
        mediaGroupId: mediaGroup.id,
        createdById: superAdmin.id,
      },
    });
  }
  console.log(`Channel masters upserted: ${channelMasterData.length}`);

  // ── Forecasting channel order ────────────────────────────────────────────────
  // The Forecasting entry table lists channels in a fixed order per category.
  // Assign sortOrder by name (creating any that don't exist yet under a fallback
  // media group). Idempotent: re-running just re-sets sortOrder.
  const FORECAST_TV = [
    'Hiru TV', 'TV Derana', 'Sirasa TV - Programming', 'Sirasa TV News', 'ITN', 'Swarnavahini',
    'Siyatha TV', 'Rupavahini', 'Derana 24X7', 'Supreme TV', 'TNL', 'Shakthi TV - Programming',
    'Shakthi TV - News', 'Vasantham TV', 'ASK Media', 'UTV', 'Dialog TV', 'Peo TV', 'Channel Eye',
    'Star Tamil', 'Capital TV', 'TV1',
  ];
  const FORECAST_RADIO = [
    'FM Derana', 'Hiru FM', 'Neth FM', 'Sirasa FM', 'Siyatha FM', 'Y FM', 'Shaa FM', 'Shree FM',
    'Sitha FM', 'Ran FM', 'SLBC', 'Rhythm FM', 'Lakhanda', 'Gold FM', 'Yes FM', 'E FM', 'Kiss FM',
    'TNL Radio network', 'Sorriyan FM', 'Shakthi FM', 'Vasantham FM', 'Thamil FM', 'Capital FM',
    'Sun FM', 'Fox FM', 'Legends FM',
  ];
  const fallbackGroup = Object.values(mediaGroupMap)[0];
  const seedOrdered = async (names, medium, base) => {
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const sortOrder = base + i;
      await prisma.channelMaster.upsert({
        where: { name },
        update: { sortOrder },
        create: { name, medium, aliases: [], isActive: true, sortOrder, mediaGroupId: fallbackGroup.id, createdById: superAdmin.id },
      });
    }
  };
  if (fallbackGroup) {
    await seedOrdered(FORECAST_TV, 'TV', 1);
    await seedOrdered(FORECAST_RADIO, 'RADIO', 101);
    // Single "total" bucket per non-TV/Radio category — the forecast entry shows
    // one total input for these instead of every channel.
    const bucketRows = [];
    for (const b of TOTAL_BUCKETS) {
      const row = await prisma.channelMaster.upsert({
        where: { name: b.name },
        update: { sortOrder: b.sortOrder, medium: b.medium, isActive: true },
        create: { name: b.name, medium: b.medium, aliases: [], isActive: true, sortOrder: b.sortOrder, mediaGroupId: fallbackGroup.id, createdById: superAdmin.id },
      });
      bucketRows.push(row);
    }
    console.log(`Forecasting channel order set: ${FORECAST_TV.length} TV, ${FORECAST_RADIO.length} radio, ${TOTAL_BUCKETS.length} category totals`);

    // NOTE: A "backfill mis-bucketed forecasts" step used to live here. It
    // repointed every MonthlyForecast whose channel was in a bucket's medium
    // onto that medium's total bucket. That was destructive once per-channel
    // entry became the normal flow — on every deploy it collapsed legitimate
    // channel-wise forecasts into "Unspecified". The narrow bug it addressed
    // (bucket channel getting deactivated → entry falling back to a real
    // channel) is already prevented by exempting the TOTAL_BUCKETS from the
    // zero-usage reconcile below, so the backfill has been removed. Deploys
    // must never mutate a group head's entered forecasts.
    void bucketRows; // kept only to ensure the bucket channels exist (upserted above)
  }

  // ── One-time replace: remove the old default master data ─────────────────────
  // Runs only while the legacy default media groups still exist, so this wipe
  // happens once (when migrating to the client-provided list) and never nukes
  // channels an admin adds later. Hard-delete where possible; if a record is
  // still referenced (schedule logs, client channels, upload rows), deactivate
  // it instead so startup never fails.
  const LEGACY_GROUPS = ['Maharaja Group', 'Capital Maharaja Group', 'Hiru Group', 'Rupavahini Group', 'Independent', 'Other'];
  const legacyExists = await prisma.mediaGroup.findFirst({ where: { name: { in: LEGACY_GROUPS } } });
  if (!legacyExists) {
    console.log('No legacy default media groups found — skipping one-time channel replace.');
  } else {
  const keepChannelNames = new Set(channelMasterData.map((c) => c.name));
  const staleChannels = await prisma.channelMaster.findMany({
    where: { name: { notIn: [...keepChannelNames] } },
    select: { id: true, name: true },
  });
  let chDeleted = 0, chDeactivated = 0;
  for (const sc of staleChannels) {
    try {
      await prisma.channelMaster.delete({ where: { id: sc.id } });
      chDeleted++;
    } catch {
      await prisma.channelMaster.update({ where: { id: sc.id }, data: { isActive: false } });
      chDeactivated++;
    }
  }

  const keepGroupNames = new Set(mediaGroupNames);
  const staleGroups = await prisma.mediaGroup.findMany({
    where: { name: { notIn: [...keepGroupNames] } },
    select: { id: true, name: true },
  });
  let mgDeleted = 0, mgDeactivated = 0;
  for (const sg of staleGroups) {
    try {
      await prisma.mediaGroup.delete({ where: { id: sg.id } });
      mgDeleted++;
    } catch {
      await prisma.mediaGroup.update({ where: { id: sg.id }, data: { active: false } });
      mgDeactivated++;
    }
  }
  console.log(`Old channel masters removed: ${chDeleted} deleted, ${chDeactivated} deactivated (still referenced)`);
  console.log(`Old media groups removed: ${mgDeleted} deleted, ${mgDeactivated} deactivated (still referenced)`);
  }

  // ── Property categories (managed in Admin; shown in Add Property) ──
  console.log('\nSeeding property categories...');
  const propertyCategories = [
    'Frequency Sponsorship',
    'Drama Sponsorship',
    'News Sponsorship',
    'Reality Sponsorship',
    'Event Sponsorship',
    'Others',
  ];
  for (let i = 0; i < propertyCategories.length; i++) {
    const name = propertyCategories[i];
    const cat = await prisma.propertyCategory.upsert({
      where: { name },
      update: {},
      create: { name, sortOrder: i, isActive: true },
    });
    console.log(`Property category created/found: ${cat.name} (id: ${cat.id})`);
  }

  // ── Clients (provided list) ──────────────────────────────────────────────────
  console.log('\nSeeding clients...');
  const agencyByName = {};
  for (const a of agencies) agencyByName[a.name.toLowerCase()] = a;

  // Prefetch every existing client's name AND aliases into one normalized set.
  // A seed client is skipped if its name matches any existing client's name OR
  // alias. Merging a seed-named client into a differently-named target records
  // the seed name as an alias on that target (see mergeClients), so this stops
  // the seed from re-creating a merged-away client on every deploy — the bug
  // where merges "un-merged" after a redeploy. Matching aliases here (not just
  // names) is what makes a merge survive future deploys.
  const existingClients = await prisma.client.findMany({ select: { name: true, aliases: true } });
  const knownClientNames = new Set();
  for (const ec of existingClients) {
    knownClientNames.add(ec.name.trim().toLowerCase());
    for (const al of ec.aliases || []) knownClientNames.add(al.trim().toLowerCase());
  }

  let clientsCreated = 0, clientsSkipped = 0;
  for (const c of CLIENTS) {
    const agency = agencyByName[c.agency.toLowerCase()];
    if (!agency) { console.warn(`  ! Agency not found for client "${c.name}": ${c.agency}`); clientsSkipped++; continue; }
    // Only seed clients that don't exist ANYWHERE yet. A client may have been
    // intentionally moved to a different agency, or merged into a same-purpose
    // client under a different name — recreating it under its original (seed)
    // agency would produce a duplicate, so skip if the name already matches an
    // existing client's name or alias.
    if (knownClientNames.has(c.name.trim().toLowerCase())) { clientsSkipped++; continue; }
    await prisma.client.create({ data: { agencyId: agency.id, name: c.name } });
    knownClientNames.add(c.name.trim().toLowerCase());
    clientsCreated++;
  }
  console.log(`Clients created: ${clientsCreated}${clientsSkipped ? `, skipped (already exist): ${clientsSkipped}` : ''}`);

  // ── Clean up duplicate client shells ─────────────────────────────────────────
  // Older seeds recreated default clients under their original agency, so moving
  // a client between agencies could leave a second, EMPTY copy of the same name.
  // Keep the record that actually has data (channels/logs) and delete the empty
  // duplicates. Names that genuinely have data under two agencies are left alone.
  try {
    const dupScan = await prisma.client.findMany({
      select: { id: true, name: true, _count: { select: { channels: true, scheduleLogs: true } } },
    });
    const byName = {};
    for (const c of dupScan) {
      const k = c.name.trim().toLowerCase();
      (byName[k] ||= []).push(c);
    }
    const hasData = (c) => c._count.channels > 0 || c._count.scheduleLogs > 0;
    let removedDupes = 0;
    for (const list of Object.values(byName)) {
      if (list.length < 2) continue;
      const empties = list.filter(c => !hasData(c));
      const withData = list.filter(hasData);
      // If something has data, delete every empty dup; if all are empty, keep one.
      const toDelete = withData.length >= 1 ? empties : list.slice(1);
      for (const c of toDelete) {
        try { await prisma.client.delete({ where: { id: c.id } }); removedDupes++; }
        catch (e) { console.warn(`  ! Could not delete duplicate client "${c.name}" (#${c.id}): ${e.message}`); }
      }
    }
    if (removedDupes) console.log(`Removed ${removedDupes} duplicate empty client record(s)`);
  } catch (e) {
    console.warn('Duplicate-client cleanup skipped:', e.message);
  }

  // ── Reconcile denormalized agency IDs (ONLY fill NULLs) ──────────────────────
  // schedule_logs.agency_id is the agency the client was under AT THAT SCHEDULE
  // MONTH (point-in-time). A client can legitimately have rows under different
  // agencies across time (e.g. Ogilvy before May 2026, RedWorks after) via the
  // "Move to another agency" tool. We must NOT re-flip those rows to the client's
  // CURRENT agency - that destroyed historical attribution and doubled/mis-showed
  // agency totals. So this reconcile now only backfills rows whose agency_id is
  // NULL (should never happen, kept as a safety net); it never overrides a set
  // value. Full/point-in-time moves are handled by moveClientAgency directly.
  try {
    const fixedLogs = await prisma.$executeRaw`
      UPDATE schedule_logs sl SET agency_id = c.agency_id
      FROM clients c
      WHERE sl.client_id = c.id AND sl.agency_id IS NULL`;
    console.log(`Agency reconcile (null-fill only): ${fixedLogs} schedule log(s) filled`);
  } catch (e) {
    console.warn('Agency reconcile skipped:', e.message);
  }

  // ── Reconcile denormalized medium/mediaGroup ─────────────────────────────────
  // ScheduleLog stores medium/media_group as a snapshot string at insert time.
  // updateChannelMaster/mergeChannelMasters keep this in sync going forward, but
  // channel edits/merges made before that fix shipped left historical rows
  // stamped with the channel's old medium/media group. Realign every row to its
  // channel master's CURRENT values. Cheap and idempotent (only touches drifted rows).
  try {
    const fixedMedium = await prisma.$executeRaw`
      UPDATE schedule_logs sl SET medium = cm.medium::text
      FROM channel_masters cm
      WHERE sl.channel_master_id = cm.id AND sl.medium <> cm.medium::text`;
    const fixedMediaGroup = await prisma.$executeRaw`
      UPDATE schedule_logs sl SET media_group = mg.name
      FROM channel_masters cm
      JOIN media_groups mg ON mg.id = cm.media_group_id
      WHERE sl.channel_master_id = cm.id AND sl.media_group <> mg.name`;
    console.log(`Medium/media-group reconcile: ${fixedMedium} medium fix(es), ${fixedMediaGroup} media-group fix(es)`);
  } catch (e) {
    console.warn('Medium/media-group reconcile skipped:', e.message);
  }

  // ── Remove zero-usage channels ───────────────────────────────────────────────
  // Any ChannelMaster with no usage at all ("0 logs" in Admin's Usage column, and
  // no client channels / upload rows / forecasts / deals) is DELETED on every
  // deploy, so merged and never-used channels stay out of the Admin Channels list
  // permanently — even though the seed re-upserts the master list above, this step
  // runs afterward and removes the unused ones again, so they can never reappear.
  // Bulk import still resolves a deleted (merged) channel by name because merge
  // keeps the source name as an alias on its target. The Print/Cinema/OOH/Digital
  // "category total" bucket channels (TOTAL_BUCKETS above) are deliberately never
  // logged against via ScheduleLog — they only ever receive MonthlyForecast rows —
  // so they are exempted by name (and by the forecasts guard) here; without this
  // they'd be removed and listForecastChannels' name-based bucket lookup would
  // silently fall back to an unrelated channel, mis-attributing category-total
  // forecasts. A channel that ever held real spend keeps its (possibly soft-
  // deleted) ScheduleLog rows, so it is preserved for history.
  try {
    // Guard: only prune on an ESTABLISHED system (one that already has schedule
    // data). On a brand-new / staging DB every seeded channel has 0 logs, so a
    // blind delete would wipe the whole channel list on first boot — skip it there
    // and keep all seeded channels available.
    const totalLogs = await prisma.scheduleLog.count();
    if (totalLogs === 0) {
      console.log('Zero-usage channel reconcile: skipped (no schedule data yet — keeping all seeded channels)');
    } else {
      const exemptNames = TOTAL_BUCKETS.map(b => b.name);
      // DELETE (not just deactivate) channel masters that have NO usage anywhere:
      // no schedule logs (a channel that ever held real data keeps its row, even if
      // soft-deleted, so it is preserved), no client channels, no upload rows, no
      // forecasts and no recorded deals. The category-total buckets are exempt by
      // name. This runs on EVERY deploy right after the seed re-upserts the master
      // list, so merged / never-used channels are removed and can never reappear in
      // the Admin Channels list. Safe by construction: the relation guards mean only
      // truly-orphan masters match, so there is no FK violation (any ChannelCommitment
      // rows cascade on delete). A merged channel's name already lives on as an alias
      // of its target, so future imports by that name still resolve correctly.
      const removed = await prisma.channelMaster.deleteMany({
        where: {
          name: { notIn: exemptNames },
          scheduleLogs: { none: {} },
          channels: { none: {} },
          uploadBatchRows: { none: {} },
          forecasts: { none: {} },
          agencyDeals: { none: {} },
          clientDeals: { none: {} },
        },
      });
      console.log(`Zero-usage channel reconcile: ${removed.count} unused channel(s) deleted`);
    }
  } catch (e) {
    console.warn('Zero-usage channel reconcile skipped:', e.message);
  }

  // ── Backfill agency-commission snapshots on historical ScheduleLog rows ──────
  // The Profit tab reads a per-row commission snapshot (commission_type_at_entry /
  // commission_rate_at_entry) captured at insert time. Rows created before that
  // shipped have no snapshot, so fill them from the client's CURRENT commission —
  // but only for clients that actually have a commission set (a null-commission
  // client's rows earn 0 profit regardless, so we leave them null). Rows touched
  // here are flagged commission_backfilled = true for audit. Idempotent: once a
  // row has a non-null commission_type_at_entry it is never re-touched, and new
  // inserts already carry their own snapshot, so this only ever fills true gaps.
  try {
    const backfilled = await prisma.$executeRaw`
      UPDATE schedule_logs sl
      SET commission_type_at_entry = c.commission_type,
          commission_rate_at_entry = c.commission_value,
          commission_backfilled = true
      FROM clients c
      WHERE sl.client_id = c.id
        AND sl.commission_type_at_entry IS NULL
        AND c.commission_type IS NOT NULL`;
    console.log(`Commission snapshot backfill: ${backfilled} schedule log(s) filled`);
  } catch (e) {
    console.warn('Commission snapshot backfill skipped:', e.message);
  }

  // ── Channel commitment: legacy (year + yearlyAmount) → period model backfill ──
  // Older commitments stored a single year + yearlyAmount. Convert each into the
  // new month-grain period model: startYear/endYear = year, Jan-Dec, and
  // monthlyAmount = yearlyAmount / 12. Idempotent: only rows that still lack a
  // monthlyAmount are touched, so genuine period entries are never rewritten.
  try {
    const legacy = await prisma.channelCommitment.findMany({
      where: { monthlyAmount: null, year: { not: null }, yearlyAmount: { not: null } },
      select: { id: true, year: true, yearlyAmount: true },
    });
    let converted = 0;
    for (const c of legacy) {
      await prisma.channelCommitment.update({
        where: { id: c.id },
        data: {
          startYear: c.year, startMonth: 1, endYear: c.year, endMonth: 12,
          monthlyAmount: Number(c.yearlyAmount) / 12,
        },
      });
      converted++;
    }
    if (converted) console.log(`Channel commitment period backfill: ${converted} legacy commitment(s) converted`);
  } catch (e) {
    console.warn('Channel commitment period backfill skipped:', e.message);
  }

  console.log('\nSeeding complete!');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
