const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.post('/api', async (req, res) => {
  try {
    const response = await axios.post('http://localhost:8081', req.body, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    let resultData = response.data;
    
    // If response is a string, extract JSON from it
    if (typeof resultData === 'string') {
      console.log('Response is a string, attempting to extract JSON...');
      
      // Remove GEOS/GDAL header (everything before the first {)
      const jsonStartIndex = resultData.indexOf('{');
      if (jsonStartIndex !== -1) {
        const jsonString = resultData.substring(jsonStartIndex);
        try {
          resultData = JSON.parse(jsonString);
          console.log('Successfully parsed JSON after removing header');
        } catch (e) {
          console.error('Failed to parse JSON from response string:', e);
          // Try with regex as fallback
          const jsonMatch = resultData.match(/\{.*\}$/s);
          if (jsonMatch) {
            try {
              resultData = JSON.parse(jsonMatch[0]);
              console.log('Successfully parsed JSON using regex');
            } catch (e2) {
              console.error('Failed to parse JSON with regex:', e2);
            }
          }
        }
      }
    }
    
    // Log what we're about to send
    console.log('Proxy server processing response...');
    
    // If function_status is success and result exists, return just the FeatureCollection
    if (resultData?.function_status === 'success' && resultData?.result?.type === 'FeatureCollection') {
      console.log('Returning nested FeatureCollection from result property');
      res.json(resultData.result);
    } else if (resultData?.type === 'FeatureCollection') {
      // Already a FeatureCollection
      console.log('Returning direct FeatureCollection');
      res.json(resultData);
    } else {
      // Return as is if we can't parse it
      console.log('Returning data as-is');
      res.json(resultData);
    }
  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(error.response?.status || 500).json({
      message: error.response?.data?.message || error.message || 'Proxy server error'
    });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
  console.log('Forwarding requests to http://localhost:8081');
});