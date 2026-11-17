import './mocks';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { Modal, Text } from 'react-native';

import { PopupModal } from '@/components/popup-modal';
import { loadWithFile } from '@/components/ui/test-utils';
import { WizardModal } from '@/components/wizard-modal';

// React Native's Modal is slow to load on a cold cache: load it with the file.
loadWithFile(Modal);

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

function Wizard(props: Partial<React.ComponentProps<typeof WizardModal>>) {
  return (
    <WizardModal
      visible
      title="vs Lions"
      stepIndex={1}
      stepCount={3}
      stepName="Time"
      onBack={jest.fn()}
      onContinue={jest.fn()}
      {...props}>
      <Text>Step body</Text>
    </WizardModal>
  );
}

describe('WizardModal', () => {
  it('shows progress as "Step 2 of 3" text, with no progress bar', async () => {
    const view = await render(<Wizard />);
    expect(screen.getByTestId('wizard-step').props.children.join('')).toBe('Step 2 of 3 · Time');
    expect(screen.getByText('vs Lions')).toBeTruthy();
    expect(view.toJSON()).toMatchSnapshot();
  });

  it('Back and Continue call their handlers', async () => {
    const onBack = jest.fn();
    const onContinue = jest.fn();
    await render(<Wizard onBack={onBack} onContinue={onContinue} continueLabel="Propose to opponent" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Propose to opponent' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['disabled', { continueDisabled: true }],
    ['busy', { continueBusy: true }],
  ])('Continue does nothing while %s, as before', async (_, props) => {
    const onContinue = jest.fn();
    await render(<Wizard onContinue={onContinue} {...props} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).not.toHaveBeenCalled();
  });
});

describe('PopupModal', () => {
  it('renders title, body and footer; Close and Back call their handlers', async () => {
    const onClose = jest.fn();
    const onBack = jest.fn();
    const view = await render(
      <PopupModal visible title="Select country" onClose={onClose} onBack={onBack} footer={<Text>Footer</Text>}>
        <Text>Body</Text>
      </PopupModal>
    );
    expect(screen.getByText('Select country')).toBeTruthy();
    expect(screen.getByText('Body')).toBeTruthy();
    expect(screen.getByText('Footer')).toBeTruthy();
    expect(view.toJSON()).toMatchSnapshot();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('has no Back button unless asked', async () => {
    await render(
      <PopupModal visible title="Match found" onClose={jest.fn()}>
        <Text>Body</Text>
      </PopupModal>
    );
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });
});
