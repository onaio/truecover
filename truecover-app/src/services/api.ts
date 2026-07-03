import axios from 'axios';
import { Organization, OrganizationMember, Project, Campaign } from '../types';
import { env } from '../config/env';

const API_URL = env.VITE_API_URL;

// Organization API calls
export const organizationsApi = {
  async create(name: string, token: string): Promise<Organization> {
    const response = await axios.post(
      `${API_URL}/api/organizations`,
      { name },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  },

  async list(token: string): Promise<Organization[]> {
    const response = await axios.get(
      `${API_URL}/api/organizations`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data.organizations;
  },

  async get(organizationId: string, token: string): Promise<Organization> {
    const response = await axios.get(
      `${API_URL}/api/organizations/${organizationId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  },

  async getMembers(organizationId: string, token: string): Promise<OrganizationMember[]> {
    const response = await axios.get(
      `${API_URL}/api/organizations/${organizationId}/members`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data.members;
  },

  async addMember(organizationId: string, email: string, token: string): Promise<OrganizationMember> {
    const response = await axios.post(
      `${API_URL}/api/organizations/${organizationId}/members`,
      { email },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  },

  async removeMember(organizationId: string, memberId: string, token: string): Promise<void> {
    await axios.delete(
      `${API_URL}/api/organizations/${organizationId}/members/${memberId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
  },

  async update(organizationId: string, name: string, token: string): Promise<Organization> {
    const response = await axios.put(
      `${API_URL}/api/organizations/${organizationId}`,
      { name },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  },

  async delete(organizationId: string, token: string): Promise<void> {
    await axios.delete(
      `${API_URL}/api/organizations/${organizationId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
  }
};

// Projects API calls
export const projectsApi = {
  async create(organizationId: string, title: string, description: string, token: string): Promise<Project> {
    const response = await axios.post(
      `${API_URL}/api/organizations/${organizationId}/projects`,
      { title, description },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  },

  async list(organizationId: string, token: string): Promise<Project[]> {
    const response = await axios.get(
      `${API_URL}/api/organizations/${organizationId}/projects`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data.projects;
  },

  async get(projectId: string, token: string): Promise<Project> {
    const response = await axios.get(
      `${API_URL}/api/projects/${projectId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  },

  async update(
    projectId: string,
    data: {
      title?: string;
      description?: string;
      odk_api_key?: string | null;
      odk_host_url?: string | null;
    },
    token: string
  ): Promise<Project> {
    const response = await axios.put(
      `${API_URL}/api/projects/${projectId}`,
      data,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  },

  async delete(projectId: string, token: string): Promise<void> {
    await axios.delete(
      `${API_URL}/api/projects/${projectId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
  }
};

// Campaigns API calls
export const campaignsApi = {
  async create(projectId: string, name: string, description: string, token: string): Promise<Campaign> {
    const response = await axios.post(
      `${API_URL}/api/projects/${projectId}/campaigns`,
      { name, description },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  },

  async list(projectId: string, token: string): Promise<Campaign[]> {
    const response = await axios.get(
      `${API_URL}/api/projects/${projectId}/campaigns`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data.campaigns;
  },

  async get(campaignId: string, token: string): Promise<Campaign> {
    const response = await axios.get(
      `${API_URL}/api/campaigns/${campaignId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  },

  async update(campaignId: string, name: string, description: string, token: string): Promise<Campaign> {
    const response = await axios.put(
      `${API_URL}/api/campaigns/${campaignId}`,
      { name, description },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  },

  async delete(campaignId: string, token: string): Promise<void> {
    await axios.delete(
      `${API_URL}/api/campaigns/${campaignId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
  }
};

// Campaign Areas API calls
export const campaignAreasApi = {
  async list(campaignId: string, token: string): Promise<any[]> {
    const response = await axios.get(
      `${API_URL}/api/campaigns/${campaignId}/areas`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data.areas;
  },

  async add(
    campaignId: string,
    data: {
      area_type: 'admin_boundary' | 'drawn';
      pcode?: string;  // For admin_boundary type
      geometry?: any;  // For drawn type
      name?: string;
    },
    token: string
  ): Promise<any> {
    const response = await axios.post(
      `${API_URL}/api/campaigns/${campaignId}/areas`,
      data,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  },

  async remove(campaignId: string, areaId: string, token: string): Promise<void> {
    await axios.delete(
      `${API_URL}/api/campaigns/${campaignId}/areas/${areaId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
  },

  async computePixels(areaId: string, token: string): Promise<{ pixels_computed: number }> {
    const response = await axios.post(
      `${API_URL}/api/campaign-areas/${areaId}/compute-pixels`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  },

  async computeAllPixels(campaignId: string, token: string): Promise<{ total_pixels_computed: number }> {
    const response = await axios.post(
      `${API_URL}/api/campaigns/${campaignId}/compute-all-pixels`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  },

  async samplePixels(
    areaId: string,
    data: {
      indicator_id: string;
      sample_count: number;
      resample?: boolean;
      round_id?: string;
      sample_target?: 'pixels' | 'buildings';
      buildings_per_pixel?: number;
      generate_replacements?: boolean;
    },
    token: string
  ): Promise<{ workflow_id: string; area_id: string; status: string; message: string }> {
    const response = await axios.post(
      `${API_URL}/api/campaign-areas/${areaId}/sample`,
      data,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  },

  async getSamplingStatus(
    workflowId: string,
    token: string
  ): Promise<{
    workflow_id: string;
    status: 'running' | 'completed' | 'failed';
    progress?: { status: string; pixels_sampled: number; round_number?: number };
    result?: { pixels_sampled: number; round_number: number };
    error?: string;
  }> {
    const response = await axios.get(
      `${API_URL}/api/campaign-areas/sample/${workflowId}/status`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  }
};

// Indicators API calls
export const indicatorsApi = {
  async create(projectId: string, name: string, description: string, token: string): Promise<any> {
    const response = await axios.post(
      `${API_URL}/api/projects/${projectId}/indicators`,
      { name, description },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  },

  async list(projectId: string, token: string): Promise<any[]> {
    const response = await axios.get(
      `${API_URL}/api/projects/${projectId}/indicators`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data.indicators;
  },

  async get(indicatorId: string, token: string): Promise<any> {
    const response = await axios.get(
      `${API_URL}/api/indicators/${indicatorId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  },

  async update(indicatorId: string, name: string, description: string, token: string): Promise<any> {
    const response = await axios.put(
      `${API_URL}/api/indicators/${indicatorId}`,
      { name, description },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  },

  async delete(indicatorId: string, token: string): Promise<void> {
    await axios.delete(
      `${API_URL}/api/indicators/${indicatorId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
  }
};

// Locations API calls
export const locationsApi = {
  async upload(
    campaignId: string,
    file: File,
    config: {
      latColumn?: string;
      lngColumn?: string;
      externalIdColumn?: string;
    },
    token: string
  ): Promise<{ workflow_id: string; status: string }> {
    const formData = new FormData();
    formData.append('file', file);
    if (config.latColumn) formData.append('latColumn', config.latColumn);
    if (config.lngColumn) formData.append('lngColumn', config.lngColumn);
    if (config.externalIdColumn) formData.append('externalIdColumn', config.externalIdColumn);

    const response = await axios.post(
      `${API_URL}/api/campaigns/${campaignId}/locations/upload/async`,
      formData,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      }
    );
    return response.data;
  },

  async getUploadStatus(
    workflowId: string,
    token: string
  ): Promise<{
    workflow_id: string;
    status: 'running' | 'completed' | 'failed';
    progress?: {
      total_features: number;
      processed_features: number;
      inserted_count: number;
      updated_count: number;
      error_count: number;
    };
    result?: {
      success: boolean;
      inserted: number;
      updated: number;
      pixels_created: number;
      errors: string[];
    };
    error?: string;
  }> {
    const response = await axios.get(
      `${API_URL}/api/locations/upload/${workflowId}/status`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  },

  async list(campaignId: string, token: string): Promise<any> {
    const response = await axios.get(
      `${API_URL}/api/campaigns/${campaignId}/locations`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  },

  async update(
    campaignId: string,
    locationId: string,
    data: {
      external_id?: string;
      exceedance_probability?: number;
      exceedance_uncertainty?: number;
      prevalence_bci_width?: number;
      prevalence_prediction?: number;
      adaptively_selected?: number;
    },
    token: string
  ): Promise<void> {
    await axios.put(
      `${API_URL}/api/campaigns/${campaignId}/locations/${locationId}`,
      data,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
  },

  async delete(campaignId: string, locationId: string, token: string): Promise<void> {
    await axios.delete(
      `${API_URL}/api/campaigns/${campaignId}/locations/${locationId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
  }
};

// Pixels API
export const pixelsApi = {
  async generate(
    campaignId: string,
    bbox: [number, number, number, number],
    level: number,
    token: string,
    append?: boolean,
    admin_pcode?: string,
    geometry?: any
  ): Promise<{ workflow_id: string; status: string; message: string }> {
    const response = await axios.post(
      `${API_URL}/api/campaigns/${campaignId}/pixels/generate`,
      { bbox, level, append, admin_pcode, geometry },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  },

  async getGenerationStatus(
    workflowId: string,
    token: string
  ): Promise<{
    workflow_id: string;
    status: string;
    progress?: { pixels_inserted: number; total_pixels?: number };
    result?: { count: number; level: number };
    error?: string;
  }> {
    const response = await axios.get(
      `${API_URL}/api/pixels/generate/workflow/${workflowId}/status`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  },

  async getStats(
    campaignId: string,
    token: string
  ): Promise<{ count: number; level: number | null; bounds: [number, number, number, number] | null }> {
    const response = await axios.get(
      `${API_URL}/api/campaigns/${campaignId}/pixels/stats`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  },

  async delete(
    campaignId: string,
    token: string
  ): Promise<{ deleted_count: number }> {
    const response = await axios.delete(
      `${API_URL}/api/campaigns/${campaignId}/pixels`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  },

  async getMetadataStats(
    campaignId: string,
    token: string
  ): Promise<{ total_enriched: number; metadata_fields: any[] }> {
    const response = await axios.get(
      `${API_URL}/api/campaigns/${campaignId}/pixels/metadata-stats`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  }
};

// Data Sources API calls
export const dataSourcesApi = {
  async list(token: string): Promise<{ data_sources: any[] }> {
    const response = await axios.get(
      `${API_URL}/api/data-sources`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  },

  async get(id: string, token: string): Promise<any> {
    const response = await axios.get(
      `${API_URL}/api/data-sources/${id}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  },

  async create(data: any, token: string): Promise<any> {
    const response = await axios.post(
      `${API_URL}/api/data-sources`,
      data,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  }
};

// Enrichment API calls
export const enrichmentApi = {
  async createJob(campaignId: string, data: { data_source_id: string; statistic?: string }, token: string): Promise<any> {
    const response = await axios.post(
      `${API_URL}/api/campaigns/${campaignId}/enrich-pixels`,
      data,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  },

  async getJob(jobId: string, token: string): Promise<any> {
    const response = await axios.get(
      `${API_URL}/api/enrichment-jobs/${jobId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  },

  async listJobs(campaignId: string, token: string): Promise<{ jobs: any[] }> {
    const response = await axios.get(
      `${API_URL}/api/campaigns/${campaignId}/enrichment-jobs`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  }
};

// Admin Boundaries API calls
export const adminBoundariesApi = {
  async getChildren(pcode: string, token: string): Promise<{
    children: Array<{
      pcode: string;
      name: string;
      level: number;
      parent_pcode: string;
      population: number;
    }>;
  }> {
    const response = await axios.get(
      `${API_URL}/api/admin-boundaries/${pcode}/children`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  },

  async getBounds(pcode: string, token: string): Promise<{ name: string; level: number; bbox: [number, number, number, number] }> {
    const response = await axios.get(
      `${API_URL}/api/admin-boundaries/${pcode}/bounds`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  },

  async getPixelSummary(pcode: string, token: string): Promise<{
    pixel_count: number;
    total_population: number;
    avg_population: number;
    pixels_with_data: number;
  }> {
    const response = await axios.get(
      `${API_URL}/api/admin-boundaries/${pcode}/pixel-summary`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  },

  async previewOvertureBuildings(pcode: string, campaignId: string, token: string, geometry?: any): Promise<{
    count: number;
    bbox: [number, number, number, number];
  }> {
    const response = await axios.post(
      `${API_URL}/api/admin-boundaries/${pcode}/preview-overture-buildings`,
      { campaign_id: campaignId, geometry },
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  },

  async importOvertureBuildings(pcode: string, campaignId: string, token: string): Promise<{
    success: boolean;
    inserted: number;
    duplicates: number;
    pixels_created: number;
    total_fetched: number;
  }> {
    const response = await axios.post(
      `${API_URL}/api/admin-boundaries/${pcode}/import-overture-buildings`,
      { campaign_id: campaignId },
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  },

  async importOvertureBuildingsAsync(pcode: string, campaignId: string, token: string, geometry?: any): Promise<{
    workflow_id: string;
    status: string;
  }> {
    const response = await axios.post(
      `${API_URL}/api/admin-boundaries/${pcode}/import-overture-buildings/async`,
      { campaign_id: campaignId, geometry },
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  },

  async getOvertureImportStatus(
    workflowId: string,
    token: string
  ): Promise<{
    workflow_id: string;
    status: 'running' | 'completed' | 'failed';
    progress?: {
      total_fetched: number;
      total_inserted: number;
      total_duplicates: number;
      batches_processed: number;
    };
    result?: {
      success: boolean;
      inserted: number;
      duplicates: number;
      pixels_created: number;
      total_fetched: number;
      batches_processed: number;
    };
    error?: string;
  }> {
    const response = await axios.get(
      `${API_URL}/api/overture/import/${workflowId}/status`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  }
};

// Ona API calls
export const onaApi = {
  async verifyCredentialsAndListProjects(
    projectId: string,
    apiKey: string,
    hostUrl: string,
    token: string
  ): Promise<{
    success: boolean;
    projects?: any[];
    error?: string;
  }> {
    const response = await axios.post(
      `${API_URL}/api/projects/${projectId}/ona/verify-credentials`,
      { api_key: apiKey, host_url: hostUrl },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  },

  async getEntityLists(
    projectId: string,
    onaProjectId: number,
    token: string
  ): Promise<{
    entity_lists: any[];
    error?: string;
  }> {
    const response = await axios.get(
      `${API_URL}/api/projects/${projectId}/ona/entity-lists?ona_project_id=${onaProjectId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  },

  async getEntities(
    projectId: string,
    token: string
  ): Promise<{
    entities: any[];
    count: number;
    error?: string;
  }> {
    const response = await axios.get(
      `${API_URL}/api/projects/${projectId}/ona/entities`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  }
};

// Entity Export API calls
export const entityExportApi = {
  async startWorkflow(
    campaignId: string,
    indicatorId: string,
    roundIds: string[],
    projectId: string,
    geometryType: string,
    token: string
  ): Promise<{
    workflow_id: string;
    status: string;
    message: string;
  }> {
    const response = await axios.post(
      `${API_URL}/api/campaigns/${campaignId}/export-entities/workflow`,
      {
        indicator_id: indicatorId,
        round_ids: roundIds,
        project_id: projectId,
        geometry_type: geometryType
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  },

  async getWorkflowStatus(
    workflowId: string,
    token: string
  ): Promise<{
    workflow_id: string;
    status: string;
    progress?: {
      total_entities: number;
      created_entities: number;
      current_label: string;
      error_message: string | null;
    };
    result?: {
      success: boolean;
      total_entities: number;
      created_entities: number;
      message: string;
    };
    error?: string;
  }> {
    const response = await axios.get(
      `${API_URL}/api/entity-export/${workflowId}/status`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  }
};
