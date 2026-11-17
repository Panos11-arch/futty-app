import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { StartingLevelForm } from '@/components/match/starting-level-form';
import { setStartingLevel } from '@/lib/match/levels-api';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock()
);
jest.mock('@/lib/match/levels-api', () => ({ setStartingLevel: jest.fn() }));

const send = setStartingLevel as jest.Mock;

beforeEach(() => send.mockReset().mockResolvedValue({ data: { level: 3.4, provisional: true }, error: null }));

async function answerAll() {
  for (const answer of ['3_10', 'amateur', 'weekly', 'mid', '7']) {
    await fireEvent.press(screen.getByTestId(`answer-${answer}`));
    await fireEvent.press(screen.getByTestId('starting-level-next'));
  }
}

describe('StartingLevelForm', () => {
  it('one question per step, "Step 2 of 5"', async () => {
    await render(<StartingLevelForm onClose={jest.fn()} />);
    expect(screen.getByTestId('starting-level-step')).toHaveTextContent('Step 1 of 5');
    await fireEvent.press(screen.getByTestId('answer-1_3'));
    await fireEvent.press(screen.getByTestId('starting-level-next'));
    expect(screen.getByTestId('starting-level-step')).toHaveTextContent('Step 2 of 5');
    expect(screen.getByText('What is the highest level you have played at?')).toBeTruthy();
  });

  it('Next waits for an answer', async () => {
    await render(<StartingLevelForm onClose={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('starting-level-next'));
    expect(screen.getByTestId('starting-level-step')).toHaveTextContent('Step 1 of 5');
  });

  it('sends the five answers and shows the level the server returns', async () => {
    const onClose = jest.fn();
    await render(<StartingLevelForm onClose={onClose} />);
    await answerAll();
    expect(send).toHaveBeenCalledWith({ years: '3_10', highest: 'amateur', frequency: 'weekly', position: 'mid', selfRating: '7' });
    await waitFor(() => expect(screen.getByTestId('starting-level-value')).toHaveTextContent('3.4'));
    await fireEvent.press(screen.getByTestId('starting-level-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('can be skipped without sending anything', async () => {
    const onClose = jest.fn();
    await render(<StartingLevelForm onClose={onClose} />);
    await fireEvent.press(screen.getByTestId('answer-1_3'));
    await fireEvent.press(screen.getByTestId('starting-level-next'));
    await fireEvent.press(screen.getByTestId('starting-level-skip'));
    expect(onClose).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('a refusal shows in words', async () => {
    send.mockResolvedValue({ data: null, error: { message: 'level_already_set' } });
    await render(<StartingLevelForm onClose={jest.fn()} />);
    await answerAll();
    await waitFor(() => expect(screen.getByText('Your starting level is already set.')).toBeTruthy());
  });

  it('Back keeps the earlier answer', async () => {
    await render(<StartingLevelForm onClose={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('answer-1_3'));
    await fireEvent.press(screen.getByTestId('starting-level-next'));
    await fireEvent.press(screen.getByTestId('starting-level-back'));
    expect(screen.getByText('Picked')).toBeTruthy();
  });
});
