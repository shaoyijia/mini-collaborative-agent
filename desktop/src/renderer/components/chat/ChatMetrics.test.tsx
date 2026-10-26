import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import ChatMetrics from './ChatMetrics';

test('shows restored usage in either metric format', () => {
  const { rerender } = render(
    <ChatMetrics
      tutorMetrics={{
        prompt_tokens: 1200,
        completion_tokens: 300,
        duration_ms: 2000,
      }}
    />,
  );
  expect(screen.getByText('1.2k in / 300 out / 2.0s')).toBeInTheDocument();
  rerender(
    <ChatMetrics
      tutorMetrics={{ input_tokens: 200, output_tokens: 50, duration_ms: 500 }}
    />,
  );
  expect(screen.getByText('200 in / 50 out / 500ms')).toBeInTheDocument();
});
