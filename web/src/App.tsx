import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './api/client';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Pantry } from './pages/Pantry';
import { Scan } from './pages/Scan';
import { Recipes } from './pages/Recipes';
import { Profile } from './pages/Profile';
import { Chat } from './pages/Chat';

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/pantry" element={<Pantry />} />
            <Route path="/scan" element={<Scan />} />
            <Route path="/recipes" element={<Recipes />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/profile" element={<Profile />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
