import React, { useState } from 'react';
import axios from 'axios';
import './App.css';
import FileUpload from './components/FileUpload';
import SamplingForm from './components/SamplingForm';
import ResultsTable from './components/ResultsTable';
import MapView from './components/MapView';
import { FileData, SamplingRequest } from './types';

type AppView = 'home' | 'adaptive-sampling' | 'coverage-prediction';

function App() {
  const [currentView, setCurrentView] = useState<AppView>('home');
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileLoaded = (data: FileData) => {
    setFileData(data);
    setResult(null);
    setError(null);
  };

  const handleSubmit = async (batchSize: number, fieldName: string) => {
    if (!fileData) return;

    setIsLoading(true);
    setError(null);

    const request: SamplingRequest = {
      point_data: fileData.data,
      uncertainty_fieldname: fieldName,
      batch_size: batchSize
    };

    try {
      const response = await axios.post('http://localhost:3001/api', request, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log('Response from service:', response.data);
      
      // Just store the response as a formatted JSON string
      let resultStr = '';
      if (typeof response.data === 'string') {
        // If it's a string, try to extract JSON part
        const jsonMatch = response.data.match(/\{.*\}$/s);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            resultStr = JSON.stringify(parsed, null, 2);
          } catch {
            resultStr = response.data;
          }
        } else {
          resultStr = response.data;
        }
      } else {
        resultStr = JSON.stringify(response.data, null, 2);
      }
      
      setResult(resultStr);
    } catch (err: any) {
      console.error('Error calling adaptive sampling service:', err);
      setError(
        err.response?.data?.message || 
        err.message || 
        'Failed to connect to the adaptive sampling service on localhost:8081'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;

    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(result);
    const exportFileDefaultName = 'adaptive_sampling_result.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result);
    alert('Result copied to clipboard!');
  };

  const renderHomePage = () => (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#f5f5f5',
      padding: '20px'
    }}>
      <h1 style={{
        fontSize: '48px',
        marginBottom: '20px',
        color: '#282c34'
      }}>
        TrueCover
      </h1>
      <p style={{
        fontSize: '18px',
        color: '#666',
        marginBottom: '50px'
      }}>
        Select a tool to get started
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '30px',
        maxWidth: '800px',
        width: '100%'
      }}>
        <div
          onClick={() => setCurrentView('adaptive-sampling')}
          style={{
            backgroundColor: 'white',
            padding: '40px',
            borderRadius: '12px',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
            cursor: 'pointer',
            transition: 'transform 0.2s, box-shadow 0.2s',
            textAlign: 'center'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-5px)';
            e.currentTarget.style.boxShadow = '0 8px 12px rgba(0, 0, 0, 0.15)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
          }}
        >
          <h2 style={{
            fontSize: '24px',
            marginBottom: '15px',
            color: '#282c34'
          }}>
            Adaptive Sampling
          </h2>
          <p style={{
            color: '#666',
            lineHeight: '1.6'
          }}>
            Optimize your survey sampling with intelligent adaptive algorithms
          </p>
        </div>

        <div
          onClick={() => setCurrentView('coverage-prediction')}
          style={{
            backgroundColor: 'white',
            padding: '40px',
            borderRadius: '12px',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
            cursor: 'pointer',
            transition: 'transform 0.2s, box-shadow 0.2s',
            textAlign: 'center'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-5px)';
            e.currentTarget.style.boxShadow = '0 8px 12px rgba(0, 0, 0, 0.15)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
          }}
        >
          <h2 style={{
            fontSize: '24px',
            marginBottom: '15px',
            color: '#282c34'
          }}>
            Coverage Prediction
          </h2>
          <p style={{
            color: '#666',
            lineHeight: '1.6'
          }}>
            Predict and analyze coverage patterns for your survey data
          </p>
        </div>
      </div>
    </div>
  );

  const renderAdaptiveSampling = () => (
    <div className="App">
      <header style={{
        backgroundColor: '#282c34',
        padding: '20px',
        color: 'white',
        marginBottom: '30px'
      }}>
        <button
          onClick={() => {
            setCurrentView('home');
            setFileData(null);
            setResult(null);
            setError(null);
          }}
          style={{
            backgroundColor: 'transparent',
            color: 'white',
            border: '1px solid white',
            padding: '8px 16px',
            borderRadius: '4px',
            cursor: 'pointer',
            marginBottom: '15px',
            fontSize: '14px'
          }}
        >
          ← Back to Home
        </button>
        <h1>Adaptive Sampling</h1>
        <p>Upload a GeoJSON or CSV file to perform adaptive sampling</p>
      </header>

      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '20px'
      }}>
        <FileUpload onFileLoaded={handleFileLoaded} />

        {fileData && (
          <>
            <MapView
              data={fileData.data}
              selectedData={result ? JSON.parse(result) : null}
            />

            <SamplingForm
              fileData={fileData}
              onSubmit={handleSubmit}
              isLoading={isLoading}
            />
          </>
        )}

        {error && (
          <div style={{
            padding: '15px',
            backgroundColor: '#f8d7da',
            border: '1px solid #f5c6cb',
            borderRadius: '4px',
            color: '#721c24',
            marginTop: '20px'
          }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {result && (
          <div style={{
            marginTop: '20px',
            padding: '20px',
            backgroundColor: '#f8f9fa',
            borderRadius: '8px',
            border: '1px solid #dee2e6'
          }}>
            <h3>Sampling Results</h3>

            {/* Show summary of selected points */}
            {(() => {
              try {
                const data = JSON.parse(result);
                const features = data.features || data.result?.features || [];
                const selectedCount = features.filter((f: any) =>
                  f.properties?.adaptively_selected === 1 ||
                  f.properties?.adaptively_selected === true
                ).length;
                const totalCount = features.length;

                return (
                  <div style={{
                    marginBottom: '15px',
                    padding: '10px',
                    backgroundColor: selectedCount > 0 ? '#d4edda' : '#f8d7da',
                    border: `1px solid ${selectedCount > 0 ? '#c3e6cb' : '#f5c6cb'}`,
                    borderRadius: '4px',
                    color: selectedCount > 0 ? '#155724' : '#721c24'
                  }}>
                    <strong>Summary:</strong> {selectedCount} out of {totalCount} points selected for sampling
                    {selectedCount > 0 && (
                      <div style={{ marginTop: '5px', fontSize: '12px' }}>
                        Look for <code style={{ backgroundColor: '#fff', padding: '2px 4px' }}>
                          "adaptively_selected": 1
                        </code> in the results below
                      </div>
                    )}
                  </div>
                );
              } catch {
                return null;
              }
            })()}

            <div style={{ marginBottom: '10px', display: 'flex', gap: '10px' }}>
              <button
                onClick={handleCopy}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Copy to Clipboard
              </button>
              <button
                onClick={handleDownload}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Download Results
              </button>
            </div>
            <ResultsTable resultText={result} />
          </div>
        )}
      </div>
    </div>
  );

  const renderCoveragePrediction = () => (
    <div className="App">
      <header style={{
        backgroundColor: '#282c34',
        padding: '20px',
        color: 'white',
        marginBottom: '30px'
      }}>
        <button
          onClick={() => setCurrentView('home')}
          style={{
            backgroundColor: 'transparent',
            color: 'white',
            border: '1px solid white',
            padding: '8px 16px',
            borderRadius: '4px',
            cursor: 'pointer',
            marginBottom: '15px',
            fontSize: '14px'
          }}
        >
          ← Back to Home
        </button>
        <h1>Coverage Prediction</h1>
        <p>Predict and analyze coverage patterns</p>
      </header>

      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '20px',
        textAlign: 'center'
      }}>
        <div style={{
          padding: '60px 40px',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px',
          border: '1px solid #dee2e6'
        }}>
          <h2 style={{ color: '#666', marginBottom: '20px' }}>Coming Soon</h2>
          <p style={{ color: '#999' }}>Coverage Prediction tool is under development</p>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {currentView === 'home' && renderHomePage()}
      {currentView === 'adaptive-sampling' && renderAdaptiveSampling()}
      {currentView === 'coverage-prediction' && renderCoveragePrediction()}
    </>
  );
}

export default App;
