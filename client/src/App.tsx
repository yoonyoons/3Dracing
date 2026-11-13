import { usePath } from './router';
import { Home } from './pages/Home';
import { Solo } from './pages/Solo';

export function App() {
  const path = usePath();
  if (path.startsWith('/solo')) return <Solo />;
  return <Home />;
}
