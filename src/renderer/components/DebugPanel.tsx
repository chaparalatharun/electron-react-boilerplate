import React, { useState, useEffect, useRef } from 'react';

const DebugPanel: React.FC = () => {
  const [models, setModels] = useState<string[]>([]);
  const [modelInfo, setModelInfo] = useState<any[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [modelLoaded, setModelLoaded] = useState(false);
  const [prompt, setPrompt] = useState('Explain quantum computing in one sentence.');
  const [response, setResponse] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const streamingTextRef = useRef('');

  const addLog = (message: string) => {
    console.log(message);
    setLogs(prev => [...prev, `[${new Date().toISOString()}] ${message}`]);
  };

  useEffect(() => {
    async function loadModels() {
      try {
        addLog('Checking for models...');
        const llama = (window as any).llama;
        if (!llama) {
          throw new Error('Llama API not available in window object');
        }

        const hasModels = await llama.hasModels();
        addLog(`Has models: ${hasModels}`);

        if (hasModels) {
          const modelList = await llama.getModels();
          addLog(`Found ${modelList.length} models`);
          setModels(modelList);

          try {
            const info = await llama.checkModels();
            addLog('Retrieved model info');
            setModelInfo(info);
          } catch (error) {
            addLog(`Error checking models: ${error}`);
          }
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        addLog(`Error loading models: ${errorMessage}`);
        setError(errorMessage);
      }
    }

    loadModels();

    try {
      const llama = (window as any).llama;
      if (llama) {
        const removeStreamData = llama.onStreamData(({ chunk }: { chunk: string }) => {
          addLog(`Received stream chunk (${chunk.length} chars)`);
          setStreamingText(prev => {
            const updated = prev + chunk;
            streamingTextRef.current = updated;
            return updated;
          });
        });

        const removeStreamEnd = llama.onStreamEnd((_event: { fullResponse: string }) => {
          addLog('Stream ended');
          setLoading(false);
          setStreaming(false);
          setResponse(streamingTextRef.current);
        });

        const removeStreamError = llama.onStreamError(({ error }: { error: string }) => {
          addLog(`Stream error: ${error}`);
          setError(error);
          setLoading(false);
          setStreaming(false);
        });

        return () => {
          addLog('Cleaning up listeners');
          removeStreamData();
          removeStreamEnd();
          removeStreamError();
          llama.stopProcesses();
        };
      }
    } catch (err) {
      addLog(`Error setting up stream handlers: ${err}`);
    }
  }, []);

  const handleLoadModel = async () => {
    if (!selectedModel) return;
    setError(null);
    setLoading(true);
    addLog(`Loading model: ${selectedModel}`);

    try {
      const llama = (window as any).llama;
      const result = await llama.loadModel(selectedModel);

      if (result.success) {
        addLog('Model loaded successfully');
        setModelLoaded(true);
      } else {
        addLog(`Failed to load model: ${result.error || 'unknown error'}`);
        setError(result.error || 'Failed to load model');
        setModelLoaded(false);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      addLog(`Error loading model: ${errorMessage}`);
      setError(errorMessage);
      setModelLoaded(false);
    } finally {
      setLoading(false);
    }
  };

  const handleQuery = async () => {
    if (!modelLoaded) {
      alert('Please load a model first');
      return;
    }

    setError(null);
    setLoading(true);
    setResponse('');
    addLog(`Querying model with prompt: "${prompt}"`);

    try {
      const llama = (window as any).llama;
      const result = await llama.queryModel(prompt, {
        temperature: 0.7,
        maxTokens: 200
      });

      if (result.success) {
        addLog('Query completed successfully');
        setResponse(result.response);
      } else {
        addLog(`Query failed: ${result.error || 'unknown error'}`);
        setError(result.error || 'Query failed');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      addLog(`Error querying model: ${errorMessage}`);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleStreamingQuery = () => {
    if (!modelLoaded) {
      alert('Please load a model first');
      return;
    }

    setError(null);
    setLoading(true);
    setStreaming(true);
    setStreamingText('');
    streamingTextRef.current = '';
    addLog(`Starting streaming query with prompt: "${prompt}"`);

    try {
      const llama = (window as any).llama;
      llama.streamQuery(prompt, {
        temperature: 0.7,
        maxTokens: 200
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      addLog(`Error starting streaming query: ${errorMessage}`);
      setError(errorMessage);
      setLoading(false);
      setStreaming(false);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto', height: '100%', overflowY: 'auto' }}>
      <h2>LLaMA Model Debugger</h2>

      {error && (
        <div style={{ 
          padding: '10px', 
          backgroundColor: '#ffebee', 
          color: '#c62828', 
          borderRadius: '4px',
          marginBottom: '20px' 
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <div style={{ marginBottom: '20px' }}>
        <h3>Available Models</h3>
        {models.length === 0 ? (
          <p>No models found</p>
        ) : (
          <ul>
            {modelInfo.map((info, index) => (
              <li key={index}>
                <label>
                  <input
                    type="radio"
                    name="model"
                    value={models[index]}
                    checked={selectedModel === models[index]}
                    onChange={() => setSelectedModel(models[index])}
                  />
                  {info.name} ({info.formattedSize}, {info.quantization})
                </label>
              </li>
            ))}
          </ul>
        )}
        <button 
          onClick={handleLoadModel} 
          disabled={!selectedModel || loading}
        >
          Load Selected Model
        </button>
        {modelLoaded && <span style={{ color: 'green', marginLeft: '10px' }}>✓ Model loaded</span>}
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h3>Query Model</h3>
        <textarea
          rows={4}
          style={{ width: '100%', marginBottom: '10px' }}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={loading}
        />
        <div>
          <button 
            onClick={handleQuery} 
            disabled={!modelLoaded || loading}
            style={{ marginRight: '10px' }}
          >
            Standard Query
          </button>
          <button 
            onClick={handleStreamingQuery} 
            disabled={!modelLoaded || loading}
          >
            Streaming Query
          </button>
        </div>
      </div>

      <div>
        <h3>Response</h3>
        {loading && <p>Loading...</p>}
        <div style={{ 
          whiteSpace: 'pre-wrap', 
          border: '1px solid #ccc',
          padding: '10px',
          minHeight: '100px'
        }}>
          {streaming ? streamingText : response}
        </div>
      </div>
    </div>
  );
};

export default DebugPanel;