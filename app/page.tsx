"use client"
import Image from "next/image";
import { useForm } from "@/contexts/FormContext";

export default function Home() {
  const { formData, displayData, errors, updateField, handleSubmit, handleReset } = useForm();

  return (
    <div className="main-content w-full bg-white dark:bg-black">
      <div className=" min-h-screen w-full gap-2 bg-white dark:bg-black py-5 px-5">
        <div className="grid grid-cols-12 gap-2">
        <div className="col-span-12 ">
          <h1 className="text-3xl font-bold text-black dark:text-white">BrenForm</h1>
        </div>
        <div className="md:col-span-4 col-span-12">
          <p className="text-lg font-semibold text-black dark:text-white">Name <span className="text-red-500">*</span></p>
          <input
            type="text"
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-2 py-1 text-black dark:text-white bg-white dark:bg-gray-800"
            value={formData.name}
            max={20}
            onChange={(e) => updateField('name', e.target.value)}
          />
          {errors?.name && <p className="text-red-500">{errors?.name}</p>}
        </div>
        <div className="md:col-span-4 col-span-12">
          <p className="text-lg font-semibold text-black dark:text-white">Age (optional)</p>
          <input
            type="number"
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-2 py-1 text-black dark:text-white bg-white dark:bg-gray-800"
            value={formData.age}
            onChange={(e) => {
              const value = e.target.value;
              if (value.length <= 2) {
                updateField('age', value);
              }
            }}
          />
          {errors?.age && <p className="text-red-500">{errors?.age}</p>}
        </div>
        <div className="md:col-span-4 col-span-12">
          <p className="text-lg font-semibold text-black dark:text-white">Email <span className="text-red-500">*</span></p>
          <input
            type="email"
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-2 py-1 text-black dark:text-white bg-white dark:bg-gray-800"
            value={formData.email}
            onChange={(e) => updateField('email', e.target.value)}
          />
          {errors?.email && <p className="text-red-500">{errors?.email}</p>}
        </div>
        <div className="md:col-span-4 col-span-12">
          <p className="text-lg font-semibold text-black dark:text-white">Phone Number <span className="text-red-500">*</span></p>
          <input
            type="number"
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-2 py-1 text-black dark:text-white bg-white dark:bg-gray-800"
            value={formData.phoneNumber}
            max={10}
            onChange={(e) => {
              const value = e.target.value;
              if (value.length <= 10) {
                updateField('phoneNumber', value);
              }
            }}
          />
          {errors?.phoneNumber && <p className="text-red-500">{errors?.phoneNumber}</p>}
        </div>
        <div className="col-span-12 flex gap-2">
          <button className="rounded-md bg-green-500  text-white w-[50%] px-2 py-1" onClick={handleSubmit}>Submit</button>
          <button className="rounded-md bg-red-300  text-white w-[50%] px-2 py-1" onClick={handleReset}>Reset</button>
        </div>
        {Object.keys(displayData).length !== 0 && displayData.name && (
          <div className="md:col-span-4 col-span-12">
            <p className="text-lg font-semibold text-black dark:text-white">Name: {displayData.name}</p>
            {displayData.age && <p className="text-lg font-semibold text-black dark:text-white">Age: {displayData.age}</p>}
            <p className="text-lg font-semibold text-black dark:text-white">Email: {displayData.email}</p>
            <p className="text-lg font-semibold text-black dark:text-white">Phone Number: {displayData.phoneNumber}</p>
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
