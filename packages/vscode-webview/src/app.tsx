import { useMemo } from 'react';

import { AuthPrompt } from './components/auth-prompt';
import { Header } from './components/header';
import { InputBar } from './components/input-bar';
import { FeatureNamesContext, FeatureStagesContext } from './components/markdown';
import { MessageList } from './components/message-list';
import { VersionBlocked } from './components/version-blocked';
import { useChatController } from './state/use-chat-controller';
import type { UserTurn } from './utils/types.ts';

export function App() {
  const c = useChatController();

  // No character-length cap — Header's own `truncate` className already
  // clips this visually. A hard character slice risked cutting a canonical
  // `<kind:value>` tag in half mid-token, leaving an unclosed, unrenderable
  // fragment (e.g. `<d:0121ab7f-aa6a-4182-9e71-9ccd220fa887` with no
  // closing `>`) that HighlightedText can't turn into a chip — CSS
  // truncation clips at the rendered pixel width instead, after the tag has
  // already become a real chip, so it can never split one open.
  const title = useMemo(() => {
    const firstUserTurn = c.turns.find((t): t is UserTurn => t.role === 'user' && !!t.text.trim());
    if (!firstUserTurn) return 'New chat';
    return firstUserTurn.text.trim().replace(/\s+/g, ' ');
  }, [c.turns]);

  // Takes over the ENTIRE panel — no header/transcript/composer underneath,
  // and no dismiss button — once the backend reports this version as
  // incompatible. Checked before anything else renders.
  if (c.versionBlocked) {
    return <VersionBlocked entry={c.versionBlocked} onUpdate={c.openMarketplace} />;
  }

  return (
    <FeatureNamesContext.Provider value={c.featureNames}>
      <FeatureStagesContext.Provider value={c.featureStages}>
        <AuthPrompt visible={c.authPromptVisible} onConnect={c.connect} />
        <Header
          visible={c.isConnected}
          title={title}
          onNewChat={c.clearChatClick}
          featureNames={c.featureNames}
          featureStages={c.featureStages}
        />
        <MessageList
          visible={c.isConnected}
          turns={c.turns}
          isBusy={c.isBusy}
          loaderSeconds={c.loaderSeconds}
          onToggleThinking={c.toggleThinking}
          onToggleToolOutput={c.toggleToolOutput}
          onSubmitClarify={c.submitClarifyAnswer}
          onRespondApproval={c.respondApproval}
          onPromptClick={c.setInputValue}
        />
        <InputBar
          visible={c.isConnected}
          mode={c.mode}
          onSetMode={c.setMode}
          availableModels={c.availableModels}
          selectedModelId={c.selectedModelId}
          onSelectModel={c.selectModel}
          inputValue={c.inputValue}
          onInputValueChange={c.setInputValue}
          activeContext={c.activeContext}
          pendingImages={c.pendingImages}
          onImagePaste={c.addPendingImage}
          onImageRemove={c.removePendingImage}
          onDropFiles={c.dropFiles}
          slashCommands={c.slashCommands}
          onRequestSlashCommands={c.requestSlashCommands}
          mentionItems={c.mentionItems}
          mentionSelectedIndex={c.mentionSelectedIndex}
          onMentionSelectedIndexChange={c.setMentionSelectedIndex}
          mentionActivePrefix={c.mentionActivePrefix}
          mentionMatchStart={c.mentionMatchStart}
          onRequestMentions={c.requestMentions}
          onCloseMentionDropdown={c.closeMentionDropdown}
          onSendMessage={c.sendMessage}
          onStopOrSend={c.stopOrSend}
          isBusy={c.isBusy}
        />
      </FeatureStagesContext.Provider>
    </FeatureNamesContext.Provider>
  );
}
