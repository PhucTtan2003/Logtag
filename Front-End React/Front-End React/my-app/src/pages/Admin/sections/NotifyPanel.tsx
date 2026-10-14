import React from "react";
import SendNotification from "../SendNotification";

type Props = { onClose: () => void };

const NotifyPanel: React.FC<Props> = ({ onClose }) => {
  return (
    <div className="confirm-overlay responsive-notify-modal">
      <div className="confirm-box wow-modal">
        <button className="close-modal-btn" onClick={onClose}>×</button>
        <SendNotification onClose={onClose} />
      </div>
    </div>
  );
};
export default NotifyPanel;
