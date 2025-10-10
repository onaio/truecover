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
