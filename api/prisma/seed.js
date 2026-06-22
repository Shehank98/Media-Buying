import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { MEDIA_GROUPS, CHANNEL_MASTERS } from './channel-seed-data.js';
import { CLIENTS } from './client-seed-data.js';

const prisma = new PrismaClient();

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

  let clientsCreated = 0, clientsSkipped = 0;
  for (const c of CLIENTS) {
    const agency = agencyByName[c.agency.toLowerCase()];
    if (!agency) { console.warn(`  ! Agency not found for client "${c.name}": ${c.agency}`); clientsSkipped++; continue; }
    await prisma.client.upsert({
      where: { agencyId_name: { agencyId: agency.id, name: c.name } },
      update: {},
      create: { agencyId: agency.id, name: c.name },
    });
    clientsCreated++;
  }
  console.log(`Clients upserted: ${clientsCreated}${clientsSkipped ? `, skipped: ${clientsSkipped}` : ''}`);

  // ── Reconcile denormalized agency IDs ────────────────────────────────────────
  // ScheduleLog/UploadBatch store agency_id at insert time. If a client was moved
  // between agencies, realign its spend so agency-level totals are correct. Cheap
  // and idempotent (only touches mismatched rows).
  try {
    const fixedLogs = await prisma.$executeRaw`
      UPDATE schedule_logs sl SET agency_id = c.agency_id
      FROM clients c
      WHERE sl.client_id = c.id AND sl.agency_id <> c.agency_id`;
    const fixedBatches = await prisma.$executeRaw`
      UPDATE upload_batches ub SET agency_id = c.agency_id
      FROM clients c
      WHERE array_length(ub.client_ids, 1) = 1 AND ub.client_ids[1] = c.id AND ub.agency_id <> c.agency_id`;
    console.log(`Agency reconcile: ${fixedLogs} schedule log(s), ${fixedBatches} upload batch(es) realigned`);
  } catch (e) {
    console.warn('Agency reconcile skipped:', e.message);
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
