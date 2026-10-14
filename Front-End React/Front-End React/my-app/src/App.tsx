// src/App.tsx



import React, { useEffect, useState } from "react";

import { BrowserRouter as Router, Routes, Route } from "react-router-dom";



import Admin from "./pages/Admin/Admin";

import HomePage from "./pages/HomePage/HomePage";

import Login from "./pages/Login";



import User from "./pages/User/User";

import UserChartPage from "./pages/User/UserChartPage";

import ExportPage from "./pages/User/ExportPage";

import UserAlertThresholds from "./pages/User/UserAlertThresholds";

import UserLayout from "./layouts/UserLayout";

import Employee from "./pages/Employee/Employee";

import EmployeeWarrantyPage from "./pages/Employee/EmployeeWarrantyPage";

import SmsSettingsPage from "./pages/User/SmsSettingsPage";



import ProfilesPage from "./pages/Profile/ProfilePage";

import SendNotification from "./pages/Admin/SendNotification";

import Unauthorized from "./pages/Unauthorized";

import ChartPage from "./pages/Admin/ChartPage";



import NoAuthRoute from "./routes/NoAuthRoute";

import { AuthProvider } from "./contexts/AuthContext";

import RequireRole from "./components/RequireRole";

import RealtimeStatus from "./pages/User/RealtimeStatus";



import ProductList from "./components/ProductList";

import Events from "./pages/EventsPage";



import SessionExpiredModal from "./components/SessionExpiredModal";

import DeviceGridPage from "./pages/Devices/DeviceGridPage";



// Provider quản lý subscription

import { SubscriptionProvider } from "./contexts/SubscriptionProvider";



import LicenseCodesPage from "./pages/Admin/LicenseCodesPage";

import SubscriptionsPage from "./pages/Admin/SubscriptionsPage";

import AdminSmsActivationsPage from "./pages/Admin/AdminSmsActivationsPage";

import AdminSmsServiceManagerPage from "./pages/Admin/AdminSmsServiceManagerPage";



// LT5/LTGeo

import Lt5ReadingsPage from "./pages/LTGEO/LT5ReadingsPage";

import Lt5ProfilesPage from "./pages/LTGEO/Lt5ProfilesPage";

import CreateShipmentLt5Page from "./pages/LTGEO/CreateShipmentLt5Page";



import FooterLayout from "./layouts/FooterLayout";

import TheNews from "./pages/HomePage/TheNews";

import ReadingArchivePage from "./pages/Admin/ReadingArchive/ReadingArchivePage";

import LogTagWebhookPage from "./pages/Admin/LogTagWebhookPage";

import StructuredData from "./../src/pages/Seo/StructuredData";

// SEO theo route:

// - Route public được khai báo => index/follow + title/description/canonical riêng.

// - Route không khai báo => mặc định noindex/nofollow.

import SeoRouteDefaults from "./pages/Seo/SeoRouteDefaults";



function App() {

  const [showExpiredModal, setShowExpiredModal] = useState(false);



  useEffect(() => {

    const onExpired = () => setShowExpiredModal(true);



    window.addEventListener("session-expired", onExpired);



    return () => window.removeEventListener("session-expired", onExpired);

  }, []);



  // Không clear toàn bộ localStorage để khỏi mất alarms:<userId>

  // và một số cache hữu ích khác.

  const safeLocalClear = () => {

    const keep: Record<string, string> = {};



    for (let i = 0; i < localStorage.length; i++) {

      const k = localStorage.key(i);

      if (!k) continue;



      if (k.startsWith("alarms:")) {

        keep[k] = localStorage.getItem(k) ?? "";

      }

    }



    localStorage.clear();



    Object.entries(keep).forEach(([k, v]) => {

      try {

        localStorage.setItem(k, v);

      } catch {

        // ignore

      }

    });

  };



  const handleModalClose = () => {

    setShowExpiredModal(false);

    safeLocalClear();

    (window as any)._expiredSessionHandled = false;

    window.location.href = "/login";

  };



  return (

    <AuthProvider>

      <Router>

        {/*

          SEO phải nằm bên trong Router vì SeoRouteDefaults dùng useLocation().

          Đặt ngoài SubscriptionProvider để SEO không phụ thuộc subscription/API user.

        */}

        <SeoRouteDefaults />

        <StructuredData />

        <SubscriptionProvider>

          <div

            className="app-shell"

            style={{

              minHeight: "100vh",

              display: "flex",

              flexDirection: "column",

            }}

          >

            <main style={{ flex: 1 }}>

              <Routes>

                {/* ===== PUBLIC ===== */}

                <Route path="/" element={<HomePage />} />



                <Route

                  path="/login"

                  element={

                    <NoAuthRoute>

                      <Login />

                    </NoAuthRoute>

                  }

                />



                {/* ===== Admin ===== */}

                <Route

                  path="/admin"

                  element={

                    <RequireRole role="admin">

                      <Admin />

                    </RequireRole>

                  }

                
                />



                <Route

                  path="/admin/reading-archive"

                  element={

                    <RequireRole role="admin">

                      <ReadingArchivePage />

                    </RequireRole>

                  }

                />



                <Route

                  path="/admin/license-codes"

                  element={

                    <RequireRole role="admin">

                      <LicenseCodesPage />

                    </RequireRole>

                  }

                />



                <Route

                  path="/admin/subscriptions"

                  element={

                    <RequireRole role="admin">

                      <SubscriptionsPage />

                    </RequireRole>

                  }

                />



                <Route

                  path="/admin/sms-activations"

                  element={

                    <RequireRole role="admin">

                      <AdminSmsActivationsPage />

                    </RequireRole>

                  }

                />



                <Route

                  path="/admin/sms-service"

                  element={

                    <RequireRole role="admin">

                      <AdminSmsServiceManagerPage />

                    </RequireRole>

                  }

                />



                <Route

                  path="/admin/logtag-webhook"

                  element={

                    <RequireRole role="admin">

                      <LogTagWebhookPage />

                    </RequireRole>

                  }

                />



                <Route

                  path="/admin/lt5geo"

                  element={

                    <RequireRole role="admin">

                      <Lt5ReadingsPage />

                    </RequireRole>

                  }

                />



                <Route

                  path="/admin/lt5/profiles"

                  element={

                    <RequireRole role="admin">

                      <Lt5ProfilesPage />

                    </RequireRole>

                  }

                />



                <Route

                  path="/admin/lt5/create-shipment"

                  element={

                    <RequireRole role="admin">

                      <CreateShipmentLt5Page />

                    </RequireRole>

                  }

                />



                {/* ===== USER: Sidebar dùng chung, kiểm tra quyền một lần ===== */}
                <Route
                  element={
                    <RequireRole role="user">
                      <UserLayout />
                    </RequireRole>
                  }
                >
                  <Route path="/user" element={<User />} />
                  <Route path="/events" element={<Events />} />
                  <Route path="/user/alert-thresholds" element={<UserAlertThresholds />} />
                  <Route path="/lt5" element={<Lt5ReadingsPage />} />
                  <Route path="/user/lt5/create-shipment" element={<CreateShipmentLt5Page />} />
                  <Route path="/sms-settings" element={<SmsSettingsPage />} />
                  <Route path="/export" element={<ExportPage />} />
                </Route>

                {/* ===== Employee ===== */}

                <Route

                  path="/employee"

                  element={

                    <RequireRole role="employee">

                      <Employee />

                    </RequireRole>

                  }

                />



                {/* ===== Others ===== */}

                <Route

                  path="/user/warranty"

                  element={<EmployeeWarrantyPage />}

                />

                <Route path="/charts/:serial?" element={<ChartPage />} />

                <Route path="/unauthorized" element={<Unauthorized />} />



                <Route

                  path="/send-notification"

                  element={

                    <RequireRole role="admin">

                      <SendNotification />

                    </RequireRole>

                  }

                />



                <Route path="/realtime-status" element={<RealtimeStatus />} />

                <Route path="/user-chart" element={<UserChartPage />} />

                <Route path="/profile/profilepage" element={<ProfilesPage />} />

                <Route path="/devices" element={<DeviceGridPage />} />

                <Route path="/products" element={<ProductList />} />

                <Route path="/news" element={<TheNews />} />

                <Route path="alert-thresholds" element={<UserAlertThresholds />} />

              </Routes>

            </main>



            {/* Footer */}

            <FooterLayout />



            {/* Modal hết hạn phiên đăng nhập */}

            <SessionExpiredModal

              open={showExpiredModal}

              onClose={handleModalClose}

            />

          </div>

        </SubscriptionProvider>

      </Router>

    </AuthProvider>

  );

}



export default App;
