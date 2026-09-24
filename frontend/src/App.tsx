import { Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Pos from "@/pages/Pos";
import Products from "@/pages/Products";
import Categories from "@/pages/Categories";
import Sales from "@/pages/Sales";
import Users from "@/pages/Users";
import Settings from "@/pages/Settings";
import Purchases from "@/pages/Purchases";
import Suppliers from "@/pages/Suppliers";
import Returns from "@/pages/Returns";
import Reports from "@/pages/Reports";
import Shifts from "@/pages/Shifts";
import Customers from "@/pages/Customers";
import Expenses from "@/pages/Expenses";
import Backup from "@/pages/Backup";
import Opname from "@/pages/Opname";
import CustomerDisplay from "@/pages/CustomerDisplay";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/pos" element={<Pos />} />
        <Route path="/products" element={<Products />} />
        <Route path="/categories" element={<Categories />} />
        <Route path="/purchases" element={<Purchases />} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/returns" element={<Returns />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/shifts" element={<Shifts />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/backup" element={<Backup />} />
        <Route path="/opname" element={<Opname />} />
        <Route path="/sales" element={<Sales />} />
        <Route path="/users" element={<Users />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="/display" element={<CustomerDisplay />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
