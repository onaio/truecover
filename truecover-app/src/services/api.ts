import axios from 'axios';
import { Organization, OrganizationMember, Project, Area } from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

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

  async update(projectId: string, title: string, description: string, token: string): Promise<Project> {
    const response = await axios.put(
      `${API_URL}/api/projects/${projectId}`,
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

// Areas API calls
export const areasApi = {
  async create(projectId: string, name: string, description: string, token: string): Promise<Area> {
    const response = await axios.post(
      `${API_URL}/api/projects/${projectId}/areas`,
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

  async list(projectId: string, token: string): Promise<Area[]> {
    const response = await axios.get(
      `${API_URL}/api/projects/${projectId}/areas`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data.areas;
  },

  async get(areaId: string, token: string): Promise<Area> {
    const response = await axios.get(
      `${API_URL}/api/areas/${areaId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  },

  async update(areaId: string, name: string, description: string, token: string): Promise<Area> {
    const response = await axios.put(
      `${API_URL}/api/areas/${areaId}`,
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

  async delete(areaId: string, token: string): Promise<void> {
    await axios.delete(
      `${API_URL}/api/areas/${areaId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
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
    areaId: string,
    file: File,
    config: {
      latColumn?: string;
      lngColumn?: string;
      externalIdColumn?: string;
    },
    token: string
  ): Promise<{ inserted: number; updated: number; errors: string[] }> {
    const formData = new FormData();
    formData.append('file', file);
    if (config.latColumn) formData.append('latColumn', config.latColumn);
    if (config.lngColumn) formData.append('lngColumn', config.lngColumn);
    if (config.externalIdColumn) formData.append('externalIdColumn', config.externalIdColumn);

    const response = await axios.post(
      `${API_URL}/api/areas/${areaId}/locations/upload`,
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

  async list(areaId: string, token: string): Promise<any> {
    const response = await axios.get(
      `${API_URL}/api/areas/${areaId}/locations`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  },

  async update(
    areaId: string,
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
      `${API_URL}/api/areas/${areaId}/locations/${locationId}`,
      data,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
  },

  async delete(areaId: string, locationId: string, token: string): Promise<void> {
    await axios.delete(
      `${API_URL}/api/areas/${areaId}/locations/${locationId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
  }
};
