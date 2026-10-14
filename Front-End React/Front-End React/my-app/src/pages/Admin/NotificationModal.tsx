import React from 'react';
import SendNotification from './SendNotification';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import '../../styles/Admin/SendNotification.css';

interface NotificationModalProps {
  onClose: () => void;
}

const NotificationModal: React.FC<NotificationModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.8, boxShadow: '0 0 0px rgba(59,130,246,0)' }}
        animate={{ opacity: 1, scale: 1, boxShadow: '0 0 30px rgba(59,130,246,0.4)' }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="relative bg-gradient-to-br from-white via-blue-50 to-blue-100 
                   rounded-2xl shadow-2xl w-full max-w-xl p-6 border border-blue-200 send-card"
      >
        <button
          title='Đóng thông báo'
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 
                     bg-white rounded-full p-1 shadow hover:shadow-md transition-all"
        >
          <X size={20} />
        </button>

        <h2 className="text-2xl font-semibold text-blue-700 mb-4 text-center">
          📢 Gửi Thông Báo
        </h2>

        <SendNotification onClose={onClose} />
      </motion.div>
    </div>
  );
};

export default NotificationModal;
