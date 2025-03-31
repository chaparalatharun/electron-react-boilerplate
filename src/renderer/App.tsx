import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import './App.css';
import DebugPanel from './components/DebugPanel';


export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<DebugPanel />} />
      </Routes>
    </Router>
  );
}
