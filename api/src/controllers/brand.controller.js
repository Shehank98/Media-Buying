import prisma from '../utils/prisma.js';

// ── Brands ──

export async function listBrands(req, res) {
  try {
    const clientId = parseInt(req.params.clientId);
    const brands = await prisma.brand.findMany({
      where: { clientId },
      include: {
        campaigns: {
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });
    return res.json({ brands });
  } catch (error) {
    console.error('List brands error:', error);
    return res.status(500).json({ error: 'Failed to list brands' });
  }
}

export async function createBrand(req, res) {
  try {
    const clientId = parseInt(req.params.clientId);
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Brand name is required' });

    const brand = await prisma.brand.create({
      data: { clientId, name },
      include: { campaigns: true },
    });
    return res.status(201).json({ brand });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'A brand with this name already exists for this client' });
    console.error('Create brand error:', error);
    return res.status(500).json({ error: 'Failed to create brand' });
  }
}

export async function updateBrand(req, res) {
  try {
    const id = parseInt(req.params.id);
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Brand name is required' });

    const brand = await prisma.brand.update({
      where: { id },
      data: { name },
      include: { campaigns: true },
    });
    return res.json({ brand });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Brand not found' });
    if (error.code === 'P2002') return res.status(409).json({ error: 'A brand with this name already exists for this client' });
    console.error('Update brand error:', error);
    return res.status(500).json({ error: 'Failed to update brand' });
  }
}

export async function deleteBrand(req, res) {
  try {
    const id = parseInt(req.params.id);
    await prisma.brand.delete({ where: { id } });
    return res.json({ message: 'Brand deleted successfully' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Brand not found' });
    console.error('Delete brand error:', error);
    return res.status(500).json({ error: 'Failed to delete brand' });
  }
}

// ── Campaigns ──

export async function listCampaigns(req, res) {
  try {
    const brandId = parseInt(req.params.brandId);
    const campaigns = await prisma.campaign.findMany({
      where: { brandId },
      orderBy: { name: 'asc' },
    });
    return res.json({ campaigns });
  } catch (error) {
    console.error('List campaigns error:', error);
    return res.status(500).json({ error: 'Failed to list campaigns' });
  }
}

export async function createCampaign(req, res) {
  try {
    const brandId = parseInt(req.params.brandId);
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Campaign name is required' });

    // Look up parent brand to get clientId
    const brand = await prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand) return res.status(404).json({ error: 'Brand not found' });

    const campaign = await prisma.campaign.create({
      data: { brandId, clientId: brand.clientId, name },
    });
    return res.status(201).json({ campaign });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'A campaign with this name already exists for this brand' });
    console.error('Create campaign error:', error);
    return res.status(500).json({ error: 'Failed to create campaign' });
  }
}

export async function updateCampaign(req, res) {
  try {
    const id = parseInt(req.params.id);
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Campaign name is required' });

    const campaign = await prisma.campaign.update({
      where: { id },
      data: { name },
    });
    return res.json({ campaign });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Campaign not found' });
    if (error.code === 'P2002') return res.status(409).json({ error: 'A campaign with this name already exists for this brand' });
    console.error('Update campaign error:', error);
    return res.status(500).json({ error: 'Failed to update campaign' });
  }
}

export async function deleteCampaign(req, res) {
  try {
    const id = parseInt(req.params.id);
    await prisma.campaign.delete({ where: { id } });
    return res.json({ message: 'Campaign deleted successfully' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Campaign not found' });
    console.error('Delete campaign error:', error);
    return res.status(500).json({ error: 'Failed to delete campaign' });
  }
}
