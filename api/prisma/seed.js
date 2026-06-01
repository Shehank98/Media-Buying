import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

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

  const mediaGroupNames = [
    'Maharaja Group',
    'Capital Maharaja Group',
    'Hiru Group',
    'Rupavahini Group',
    'Independent',
    'Other',
  ];

  const mediaGroupMap = {};

  for (const name of mediaGroupNames) {
    const group = await prisma.mediaGroup.upsert({
      where: { name },
      update: {},
      create: {
        name,
        active: true,
        createdById: superAdmin.id,
      },
    });
    mediaGroupMap[name] = group;
    console.log(`Media group created/found: ${group.name} (id: ${group.id})`);
  }

  // ── Channel Masters ─────────────────────────────────────────────────────────
  console.log('\nSeeding channel masters...');

  const channelMasterData = [
    // TV — Maharaja Group
    { name: 'TV Derana',      medium: 'TV',    mediaGroup: 'Maharaja Group',         aliases: ['Derana', 'TV Derana HD'] },
    { name: 'Derana 24',      medium: 'TV',    mediaGroup: 'Maharaja Group',         aliases: ['Derana24'] },
    { name: 'Derana Music',   medium: 'TV',    mediaGroup: 'Maharaja Group',         aliases: [] },

    // TV — Capital Maharaja Group
    { name: 'Sirasa TV',      medium: 'TV',    mediaGroup: 'Capital Maharaja Group', aliases: ['Sirasa'] },
    { name: 'Shakthi TV',     medium: 'TV',    mediaGroup: 'Capital Maharaja Group', aliases: ['Shakthi'] },
    { name: 'MTV Sports',     medium: 'TV',    mediaGroup: 'Capital Maharaja Group', aliases: ['MTV'] },

    // TV — Hiru Group
    { name: 'Hiru TV',        medium: 'TV',    mediaGroup: 'Hiru Group',             aliases: ['Hiru'] },
    { name: 'Hiru News',      medium: 'TV',    mediaGroup: 'Hiru Group',             aliases: [] },

    // TV — Rupavahini Group
    { name: 'Rupavahini',     medium: 'TV',    mediaGroup: 'Rupavahini Group',       aliases: ['Rupa', 'SLRC'] },
    { name: 'ITN',            medium: 'TV',    mediaGroup: 'Rupavahini Group',       aliases: ['ITN Sri Lanka'] },

    // TV — Other
    { name: 'TV1',            medium: 'TV',    mediaGroup: 'Other',                  aliases: [] },
    { name: 'Siyatha TV',     medium: 'TV',    mediaGroup: 'Other',                  aliases: ['Siyatha'] },
    { name: 'Supreme TV',     medium: 'TV',    mediaGroup: 'Other',                  aliases: ['Supreme'] },

    // Radio — Maharaja Group
    { name: 'Yes FM',         medium: 'RADIO', mediaGroup: 'Maharaja Group',         aliases: ['YesFM'] },
    { name: 'Shakthi FM',     medium: 'RADIO', mediaGroup: 'Maharaja Group',         aliases: [] },

    // Radio — Capital Maharaja Group
    { name: 'Sirasa FM',      medium: 'RADIO', mediaGroup: 'Capital Maharaja Group', aliases: ['SirasaFM'] },
    { name: 'Shakthi FM Radio', medium: 'RADIO', mediaGroup: 'Capital Maharaja Group', aliases: ['Shakthi Radio'] },

    // Radio — Hiru Group
    { name: 'Hiru FM',        medium: 'RADIO', mediaGroup: 'Hiru Group',             aliases: ['HiruFM'] },

    // Radio — Independent
    { name: 'TNL Radio',      medium: 'RADIO', mediaGroup: 'Independent',            aliases: ['TNL'] },
    { name: 'Gold FM',        medium: 'RADIO', mediaGroup: 'Independent',            aliases: ['GoldFM'] },
    { name: 'Ran FM',         medium: 'RADIO', mediaGroup: 'Independent',            aliases: ['RanFM'] },
    { name: 'Sooriyan FM',    medium: 'RADIO', mediaGroup: 'Independent',            aliases: ['Sooriyan'] },
    { name: 'Swiss Radio',    medium: 'RADIO', mediaGroup: 'Independent',            aliases: [] },

    // Print — Independent
    { name: 'Daily Mirror',       medium: 'PRINT', mediaGroup: 'Independent', aliases: ['Mirror'] },
    { name: 'Sunday Times',       medium: 'PRINT', mediaGroup: 'Independent', aliases: [] },
    { name: 'Daily News',         medium: 'PRINT', mediaGroup: 'Independent', aliases: [] },
    { name: 'Lankadeepa',         medium: 'PRINT', mediaGroup: 'Independent', aliases: [] },
    { name: 'Divaina',            medium: 'PRINT', mediaGroup: 'Independent', aliases: [] },
    { name: 'Virakesari',         medium: 'PRINT', mediaGroup: 'Independent', aliases: [] },
    { name: 'Thinakaran',         medium: 'PRINT', mediaGroup: 'Independent', aliases: [] },
    { name: 'Sunday Observer',    medium: 'PRINT', mediaGroup: 'Independent', aliases: [] },
    { name: 'Sunday Island',      medium: 'PRINT', mediaGroup: 'Independent', aliases: [] },
    { name: 'Ceylon Today',       medium: 'PRINT', mediaGroup: 'Independent', aliases: [] },
    { name: 'Ada Derana Online',  medium: 'PRINT', mediaGroup: 'Independent', aliases: ['Ada Derana', 'AdaDerana'] },
  ];

  for (const ch of channelMasterData) {
    const mediaGroup = mediaGroupMap[ch.mediaGroup];
    if (!mediaGroup) {
      throw new Error(`Media group not found for channel: ${ch.name} (group: ${ch.mediaGroup})`);
    }

    const channel = await prisma.channelMaster.upsert({
      where: { name: ch.name },
      update: {
        medium: ch.medium,
        aliases: ch.aliases,
        mediaGroupId: mediaGroup.id,
      },
      create: {
        name: ch.name,
        medium: ch.medium,
        aliases: ch.aliases,
        isActive: true,
        mediaGroupId: mediaGroup.id,
        createdById: superAdmin.id,
      },
    });

    console.log(`Channel master created/found: ${channel.name} [${channel.medium}] (id: ${channel.id})`);
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
