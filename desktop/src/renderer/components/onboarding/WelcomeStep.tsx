import cocoHelping from '../../../../assets/tool1.png';
import cocoReady from '../../../../assets/wait1.png';
import PetMenuIcon from '../PetMenuIcon';
import AgentBubble from '../AgentBubble';

export default function WelcomeStep() {
  return (
    <div className="ob-welcome-features">
      <div className="coco-setup-panel coco-setup-panel-padded ob-feature-card">
        <div
          className="ob-feature-scene"
          role="img"
          aria-label="Coco letting you know a reply is ready"
        >
          <img
            className="ob-feature-illustration"
            src={cocoHelping}
            alt=""
            draggable={false}
          />
          <div className="ob-feature-bubble" inert aria-hidden="true">
            <AgentBubble
              bubble={{
                kind: 'reply',
                text: 'Your reply is ready.',
                target: { sessionId: '', requestId: '' },
                fadingOut: false,
              }}
            />
          </div>
        </div>
        <div className="ob-feature-copy">
          <strong>Works with you</strong>
          <span>
            Coco asks when it needs your input and lets you know when its reply
            is ready.
          </span>
        </div>
      </div>
      <div className="coco-setup-panel coco-setup-panel-padded ob-feature-card">
        <div
          className="ob-feature-scene"
          role="img"
          aria-label="Coco’s menu with Chat highlighted"
        >
          <img
            className="ob-feature-illustration"
            src={cocoReady}
            alt=""
            draggable={false}
          />
          <div className="ob-feature-menu" aria-hidden="true">
            <div className="ob-feature-menu-active">
              <PetMenuIcon name="chat" />
              Chat
            </div>
            <div>
              <PetMenuIcon name="settings" />
              Settings
            </div>
            <div>
              <PetMenuIcon name="hide" />
              Hide
            </div>
          </div>
        </div>
        <div className="ob-feature-copy">
          <strong>A conversation away</strong>
          <span>
            Open chat from Coco’s avatar or the menu-bar icon and ask anything.
          </span>
        </div>
      </div>
    </div>
  );
}
