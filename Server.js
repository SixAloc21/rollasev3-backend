require('dotenv').config();
const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const util = require('util');
const bcrypt = require('bcrypt');
const jwt = require("jsonwebtoken"); // asegúrate de tenerlo instalado
const SECRET_KEY = "tu_secreto_super_ultra"; // o donde tengas tu secret
const PDFDocument = require('pdfkit');
const moment = require('moment');
const fs = require('fs');
const path = require('path');


const app = express();
const PORT = process.env.PORT || 5000;

const corsOptions = {
    origin: ["http://localhost:3000"],
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());

const db = mysql.createConnection({
    host: process.env.DB_HOST || "sql3.freesqldatabase.com",
    user: process.env.DB_USER || "sql3768782",
    password: process.env.DB_PASSWORD || "C4YVQVyQjB",
    database: process.env.DB_NAME || "sql3768782",
    port: process.env.DB_PORT || 3306,
    multipleStatements: true
});

db.query = util.promisify(db.query);

const connectToDatabase = () => {
    db.connect((err) => {
        if (err) {
            console.error("❌ Error conectando a MySQL:", err);
            setTimeout(connectToDatabase, 5000);
        } else {
            console.log("✅ Conectado a MySQL en", process.env.DB_HOST || "sql3.freesqldatabase.com");
        }
    });

    db.on('error', (err) => {
        console.error("⚠️ Error en la conexión a MySQL:", err);
        if (err.code === 'PROTOCOL_CONNECTION_LOST') {
            connectToDatabase();
        } else {
            throw err;
        }
    });
};

connectToDatabase();

app.post('/register', async (req, res) => {
    const { nombre, correo, contrasena } = req.body;
    if (!nombre || !correo || !contrasena) {
        return res.status(400).json({ error: "Todos los campos son obligatorios." });
    }
    try {
        const existingUser = await db.query('SELECT * FROM usuario WHERE correo = ?', [correo]);
        if (existingUser.length > 0) {
            return res.status(400).json({ error: "El correo ya está registrado." });
        }
        const hashedPassword = await bcrypt.hash(contrasena, 10);
        await db.query('INSERT INTO usuario (nombre, usuario, correo, contrasena, nombre_rol, estatus) VALUES (?, ?, ?, ?, ?, ?)', 
        [nombre, correo, correo, hashedPassword, "Cliente", 1]);
        res.status(201).json({ message: "✅ Usuario registrado exitosamente" });
    } catch (error) {
        console.error("🚨 Error en el registro:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.post('/login', async (req, res) => {
    const { correo, contrasena } = req.body;
    if (!correo || !contrasena) {
        return res.status(400).json({ error: "Correo y contraseña son obligatorios." });
    }
    try {
        const results = await db.query('SELECT * FROM usuario WHERE correo = ?', [correo]);
        if (results.length === 0) {
            return res.status(400).json({ error: "Correo o contraseña incorrectos." });
        }
        const user = results[0];
        const isMatch = await bcrypt.compare(contrasena, user.contrasena);
        if (!isMatch) {
            return res.status(400).json({ error: "Correo o contraseña incorrectos." });
        }
        const token = jwt.sign({ id_usuario: user.id_usuario, correo: user.correo, rol: user.nombre_rol }, process.env.JWT_SECRET || "secreto", { expiresIn: '1h' });
        res.json({ message: "✅ Inicio de sesión exitoso", token, usuario: user });
    } catch (error) {
        console.error("🚨 Error en el login:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// 🔐 Guardar o iniciar sesión con Google
// 🧠 Iniciar sesión con Google o registrar nuevo usuario
app.post("/store-user", async (req, res) => {
  const { correo, nombre } = req.body;

  if (!correo || !nombre) {
    return res.status(400).json({ error: "Faltan datos" });
  }

  try {
    const usuarios = await db.query("SELECT * FROM usuario WHERE correo = ?", [correo]);

    let usuario;
    if (usuarios.length > 0) {
      usuario = usuarios[0];
    } else {
      const result = await db.query(`
        INSERT INTO usuario (correo, nombre, nombre_rol, estatus, es_suscriptor, saldo) 
        VALUES (?, ?, 'Cliente', 1, 0, 0.00)`, 
        [correo, nombre]
      );

      const insertedId = result.insertId;
      const nuevos = await db.query("SELECT * FROM usuario WHERE id_usuario = ?", [insertedId]);
      usuario = nuevos[0];
    }

    // Simulación de token (puedes usar JWT si quieres después)
    const token = Buffer.from(`${usuario.id_usuario}:${usuario.nombre}`).toString("base64");

    res.json({ token, usuario });
  } catch (error) {
    console.error("❌ Error en /store-user:", error);
    res.status(500).json({ error: "Error al registrar/iniciar sesión con Google" });
  }
});

app.get("/", async (req, res) => {
    try {
        const result = await db.query("SELECT 1 + 1 AS result");
        res.json({ message: "🚀 Servidor corriendo y conectado a MySQL", result });
    } catch (error) {
        console.error("🚨 Error en la consulta:", error);
        res.status(500).json({ error: "Error al conectar con MySQL" });
    }
});

// ✅ Obtener productos (para mostrar en frontend)
app.get('/productos', async (req, res) => {
    try {
        const productos = await db.query('SELECT * FROM producto WHERE estatus = 1');
        res.status(200).json(productos);
    } catch (error) {
        console.error("🚨 Error al obtener productos:", error);
        res.status(500).json({ error: "Error al obtener productos" });
    }
});

// 🛒 Pagar y procesar carrito
app.post('/pagar', async (req, res) => {
    const { carrito, total, id_usuario } = req.body;
  
    if (!carrito || !Array.isArray(carrito) || carrito.length === 0) {
      return res.status(400).json({ error: 'El carrito está vacío.' });
    }
  
    try {
      // 🔍 Verificar saldo
      const [usuario] = await db.query("SELECT saldo FROM usuario WHERE id_usuario = ?", [id_usuario]);
      if (!usuario || usuario.saldo < total) {
        return res.status(400).json({ error: "❌ Saldo insuficiente para realizar la compra." });
      }
  
      const fecha = new Date();
  
      // ✅ Llamar al Stored Procedure para registrar venta y factura
      const rows = await db.query(
        'CALL RegistrarVentaBasica(?, ?, ?, @id_venta); SELECT @id_venta AS id_venta',
        [id_usuario, fecha, total]
      );
      const id_venta = rows[1][0].id_venta;
  
      // 🔁 Insertar detalle_venta
      for (const producto of carrito) {
        await db.query(
          'INSERT INTO detalle_venta (id_venta, id_producto, cantidad, precio_unitario) VALUES (?, ?, ?, ?)',
          [id_venta, producto.id, producto.quantity || 1, producto.price]
        );
  
        await db.query(
          'UPDATE producto SET cantidad = cantidad - ? WHERE id_producto = ?',
          [producto.quantity || 1, producto.id]
        );
      }
  
      // 💸 Restar saldo al usuario
      await db.query("UPDATE usuario SET saldo = saldo - ? WHERE id_usuario = ?", [total, id_usuario]);
  
      res.status(200).json({ message: '✅ Pago exitoso. Venta registrada.', id_venta });
    } catch (error) {
      console.error("🚨 Error en el pago:", error);
      res.status(500).json({ error: "Error procesando el pago." });
    }
  });
  

  // 💸 Recargar saldo al usuario
app.put("/recargar", async (req, res) => {
    const { id_usuario, monto } = req.body;
  
    if (!id_usuario || !monto || monto <= 0) {
      return res.status(400).json({ error: "Datos inválidos para recargar" });
    }
  
    try {
      await db.query(
        "UPDATE usuario SET saldo = saldo + ? WHERE id_usuario = ?",
        [monto, id_usuario]
      );
  
      res.status(200).json({ message: `✅ Recarga exitosa de $${monto}` });
    } catch (error) {
      console.error("❌ Error al recargar saldo:", error);
      res.status(500).json({ error: "Error al recargar saldo" });
    }
  });
  
// 📦 Registrar suscripción
app.post('/suscribirse', async (req, res) => {
    const {
      id_usuario,
      nombre_plan,
      precio,
      fecha_inicio,
      fecha_vencimiento,
      renovacion_automatica
    } = req.body;
  
    try {
      // 🔍 Verificar saldo
      const [usuario] = await db.query("SELECT saldo FROM usuario WHERE id_usuario = ?", [id_usuario]);
      if (!usuario || usuario.saldo < precio) {
        return res.status(400).json({ error: "❌ Saldo insuficiente para suscribirte." });
      }
  
      // ✅ Llamar al SP que registra la venta, factura y suscripción
      await db.query(
        'CALL RegistrarSuscripcion(?, ?, ?, ?, ?, ?)',
        [id_usuario, nombre_plan, precio, fecha_inicio, fecha_vencimiento, renovacion_automatica]
      );
  
      // 💸 Restar saldo al usuario
      await db.query("UPDATE usuario SET saldo = saldo - ? WHERE id_usuario = ?", [precio, id_usuario]);
  
      res.status(200).json({ message: "🎉 Suscripción registrada correctamente." });
    } catch (error) {
      console.error("🚨 Error al registrar suscripción:", error);
      res.status(500).json({ error: "Error al registrar suscripción" });
    }
  });  

  // 🔍 Obtener suscripción del usuario
app.get('/mis-suscripciones/:id_usuario', async (req, res) => {
    const { id_usuario } = req.params;
  
    try {
      const suscripcion = await db.query(
        'SELECT * FROM suscripcion WHERE id_usuario = ? AND estado = "Activa" LIMIT 1',
        [id_usuario]
      );
  
      if (suscripcion.length === 0) {
        return res.status(404).json({ message: "No tienes una suscripción activa" });
      }
  
      res.status(200).json(suscripcion[0]);
    } catch (error) {
      console.error("🚨 Error al obtener suscripción:", error);
      res.status(500).json({ error: "Error al obtener suscripción" });
    }
  });

  // ❌ Cancelar suscripción (solo actualiza estado)
  app.put('/cancelar-suscripcion/:id_usuario', async (req, res) => {
    const { id_usuario } = req.params;

    try {
        const result = await db.query(
            'UPDATE suscripcion SET estado = "Inactiva" WHERE id_usuario = ? AND estado = "Activa"',
            [id_usuario]
        );

        if (result.affectedRows > 0) {
            await db.query('UPDATE usuario SET es_suscriptor = 0 WHERE id_usuario = ?', [id_usuario]);
        }

        res.status(200).json({ message: "❌ Suscripción cancelada correctamente." });
    } catch (error) {
        console.error("🚨 Error al cancelar suscripción:", error);
        res.status(500).json({ error: "Error al cancelar suscripción" });
    }
});
  
// 📃 Obtener facturas por usuario
app.get("/facturas/:id_usuario", async (req, res) => {
    const { id_usuario } = req.params;
  
    try {
      const facturas = await db.query(`
        SELECT f.*, s.nombre_plan 
        FROM factura f
        INNER JOIN suscripcion s ON f.id_factura = s.id_factura
        WHERE s.id_usuario = ?
        ORDER BY f.fecha_emision DESC
      `, [id_usuario]);
  
      res.status(200).json(facturas);
    } catch (error) {
      console.error("❌ Error al obtener facturas:", error);
      res.status(500).json({ error: "Error al obtener facturas" });
    }
  });  

  // 📦 Obtener facturas de productos (no suscripciones)
app.get('/facturas-productos/:id_usuario', async (req, res) => {
    const { id_usuario } = req.params;
    try {
      const facturas = await db.query(`
        SELECT f.id_factura, f.fecha_emision, f.monto, p.nombre_producto
        FROM factura f
        JOIN venta v ON f.id_venta = v.id_venta
        JOIN detalle_venta dv ON v.id_venta = dv.id_venta
        JOIN producto p ON dv.id_producto = p.id_producto
        WHERE v.id_usuario = ?
        ORDER BY f.fecha_emision DESC
      `, [id_usuario]);
  
      res.status(200).json(facturas);
    } catch (err) {
      console.error("❌ Error al obtener facturas de productos:", err);
      res.status(500).json({ error: "Error al obtener facturas de productos" });
    }
  });  

  // 👥 Obtener todos los usuarios (para gestión)
app.get('/usuarios', async (req, res) => {
    try {
      const usuarios = await db.query(
        'SELECT id_usuario, nombre, correo, nombre_rol, estatus FROM usuario'
      );
      res.status(200).json(usuarios);
    } catch (error) {
      console.error("❌ Error al obtener usuarios:", error);
      res.status(500).json({ error: "Error al obtener usuarios" });
    }
  });
  
  // 🔄 Cambiar estatus (activar/desactivar) de un usuario
  app.put('/usuarios/:id/toggle', async (req, res) => {
    try {
      const { id } = req.params;
      const usuario = await db.query(
        'SELECT estatus FROM usuario WHERE id_usuario = ?',
        [id]
      );
  
      if (usuario.length === 0) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }
  
      const nuevoEstatus = usuario[0].estatus === 1 ? 0 : 1;
      await db.query(
        'UPDATE usuario SET estatus = ? WHERE id_usuario = ?',
        [nuevoEstatus, id]
      );
  
      res.status(200).json({ message: "✔️ Estatus actualizado", nuevoEstatus });
    } catch (error) {
      console.error("❌ Error actualizando estatus:", error);
      res.status(500).json({ error: "Error al actualizar estatus" });
    }
  });  

  // 🧾 Obtener saldo actual del usuario
app.get('/saldo/:id_usuario', async (req, res) => {
    const { id_usuario } = req.params;
  
    try {
      const result = await db.query('SELECT saldo FROM usuario WHERE id_usuario = ?', [id_usuario]);
  
      if (result.length === 0) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }
  
      res.status(200).json({ saldo: result[0].saldo });
    } catch (error) {
      console.error("❌ Error al obtener saldo:", error);
      res.status(500).json({ error: "Error al obtener saldo" });
    }
  });  

// 🧾 Obtener todos los productos (admin)
app.get('/admin/productos', async (req, res) => {
    try {
      const productos = await db.query('SELECT * FROM producto');
      res.status(200).json(productos);
    } catch (err) {
      console.error("❌ Error al obtener productos:", err);
      res.status(500).json({ error: "Error al obtener productos" });
    }
  });
  
  // ➕ Agregar nuevo producto
  app.post('/admin/productos', async (req, res) => {
    const { nombre_producto, descripcion, precio, cantidad } = req.body;
    try {
      await db.query(
        'INSERT INTO producto (nombre_producto, descripcion, precio, cantidad, estatus) VALUES (?, ?, ?, ?, 1)',
        [nombre_producto, descripcion, precio, cantidad]
      );
      res.status(201).json({ message: "✅ Producto agregado correctamente" });
    } catch (err) {
      console.error("❌ Error al agregar producto:", err);
      res.status(500).json({ error: "Error al agregar producto" });
    }
  });
  
  // ✏️ Editar producto
  app.put('/admin/productos/:id', async (req, res) => {
    const { id } = req.params;
    const { nombre_producto, descripcion, precio, cantidad } = req.body;
    try {
      await db.query(
        'UPDATE producto SET nombre_producto = ?, descripcion = ?, precio = ?, cantidad = ? WHERE id_producto = ?',
        [nombre_producto, descripcion, precio, cantidad, id]
      );
      res.status(200).json({ message: "✅ Producto actualizado" });
    } catch (err) {
      console.error("❌ Error al actualizar producto:", err);
      res.status(500).json({ error: "Error al actualizar producto" });
    }
  });

  // 🔁 Activar/Inactivar producto
app.put('/admin/productos/:id/toggle', async (req, res) => {
    const { id } = req.params;
    try {
      const result = await db.query('SELECT estatus FROM producto WHERE id_producto = ?', [id]);
      if (result.length === 0) return res.status(404).json({ error: "Producto no encontrado" });
  
      const nuevoEstatus = result[0].estatus === 1 ? 0 : 1;
      await db.query('UPDATE producto SET estatus = ? WHERE id_producto = ?', [nuevoEstatus, id]);
  
      res.status(200).json({ message: "✅ Estatus actualizado", nuevoEstatus });
    } catch (err) {
      console.error("❌ Error al cambiar estatus:", err);
      res.status(500).json({ error: "Error al cambiar estatus" });
    }
  });

  // 📄 Obtener ventas generales (con nombre del cliente)
app.get("/admin/ventas", async (req, res) => {
    try {
      const ventas = await db.query(`
        SELECT v.id_venta, v.fecha_venta, v.monto_total, u.nombre
        FROM venta v
        JOIN usuario u ON v.id_usuario = u.id_usuario
        ORDER BY v.fecha_venta DESC
      `);
      res.status(200).json(ventas);
    } catch (error) {
      console.error("❌ Error al obtener ventas:", error);
      res.status(500).json({ error: "Error al obtener ventas" });
    }
  });
  
  // 📄 Obtener detalle de venta por id
  app.get("/admin/ventas/:id", async (req, res) => {
    const { id } = req.params;
    try {
      const detalle = await db.query(`
        SELECT p.nombre_producto, dv.cantidad, dv.precio_unitario
        FROM detalle_venta dv
        JOIN producto p ON dv.id_producto = p.id_producto
        WHERE dv.id_venta = ?
      `, [id]);
      res.status(200).json(detalle);
    } catch (error) {
      console.error("❌ Error al obtener detalle:", error);
      res.status(500).json({ error: "Error al obtener detalle" });
    }
  });    

  // 📦 Obtener todas las transacciones (ventas y suscripciones)
app.get('/admin/todas-las-transacciones', async (req, res) => {
    try {
      const transacciones = await db.query(`
        SELECT 
          v.id_venta AS id,
          u.nombre AS cliente,
          v.fecha_venta AS fecha,
          'Producto' AS tipo,
          v.monto_total AS total
        FROM venta v
        INNER JOIN usuario u ON v.id_usuario = u.id_usuario
  
        UNION
  
        SELECT 
          s.id_suscripcion AS id,
          u.nombre AS cliente,
          s.fecha_inicio AS fecha,
          'Suscripción' AS tipo,
          s.precio AS total
        FROM suscripcion s
        INNER JOIN usuario u ON s.id_usuario = u.id_usuario
        WHERE s.estado = 'Activa'
  
        ORDER BY fecha DESC
      `);
  
      res.status(200).json(transacciones);
    } catch (error) {
      console.error("❌ Error al obtener transacciones:", error);
      res.status(500).json({ error: "Error al obtener transacciones" });
    }
  });  

  app.get("/admin/grafica-ventas-dia", async (req, res) => {
    try {
      const datos = await db.query(`
        SELECT DATE(fecha_venta) AS fecha, SUM(monto_total) AS total
        FROM venta
        GROUP BY DATE(fecha_venta)
        ORDER BY fecha ASC
      `);
      res.status(200).json(datos);
    } catch (error) {
      console.error("❌ Error al obtener ventas por día:", error);
      res.status(500).json({ error: "Error al obtener ventas por día" });
    }
  });
  
  app.get("/admin/grafica-ventas-mes", async (req, res) => {
    try {
      const datos = await db.query(`
        SELECT DATE_FORMAT(fecha_venta, '%Y-%m') AS mes, SUM(monto_total) AS total
        FROM venta
        GROUP BY mes
        ORDER BY mes ASC
      `);
      res.status(200).json(datos);
    } catch (error) {
      console.error("❌ Error al obtener ventas por mes:", error);
      res.status(500).json({ error: "Error al obtener ventas por mes" });
    }
  });

  app.get("/admin/frecuencia-clientes", async (req, res) => {
    try {
      const datos = await db.query(`
        SELECT u.nombre AS cliente, COUNT(v.id_venta) AS compras
        FROM venta v
        JOIN usuario u ON v.id_usuario = u.id_usuario
        GROUP BY u.id_usuario
        ORDER BY compras DESC
        LIMIT 7
      `);
      res.status(200).json(datos);
    } catch (error) {
      console.error("❌ Error al obtener frecuencia de clientes:", error);
      res.status(500).json({ error: "Error al obtener frecuencia de clientes" });
    }
  });

  // 🧠 Endpoint con estadísticas
app.get('/admin/productos/estadisticas', async (req, res) => {
    try {
      const [masVendido] = await db.query(`
        SELECT p.nombre_producto, SUM(dv.cantidad) as total
        FROM detalle_venta dv
        JOIN producto p ON dv.id_producto = p.id_producto
        GROUP BY p.id_producto
        ORDER BY total DESC
        LIMIT 1
      `);
  
      const [stock] = await db.query(`SELECT SUM(cantidad) AS total FROM producto`);
  
      res.json({
        masVendido: masVendido ? masVendido.nombre_producto : null,
        totalStock: stock?.total || 0
      });
    } catch (error) {
      console.error("❌ Error obteniendo estadísticas:", error);
      res.status(500).json({ error: "Error interno" });
    }
  });  

  // 🧾 Reporte PDF - Productos (¡enviar como archivo!)
    // 🧾 Reporte PDF - Productos mejorado
app.get("/admin/reporte-productos", async (req, res) => {
    try {
      const productos = await db.query(`
        SELECT id_producto, nombre_producto, descripcion, precio, cantidad, estatus
        FROM producto
      `);
  
      const masVendido = await db.query(`
        SELECT p.nombre_producto
        FROM detalle_venta dv
        JOIN producto p ON dv.id_producto = p.id_producto
        GROUP BY dv.id_producto
        ORDER BY SUM(dv.cantidad) DESC
        LIMIT 1
      `);
  
      const totalStock = await db.query(`SELECT SUM(cantidad) AS total_stock FROM producto`);
  
      // Creamos PDF
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      let buffers = [];
  
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="reporte_productos.pdf"',
          'Content-Length': pdfData.length
        });
        res.end(pdfData);
      });
  
      // TÍTULO
      doc.font('Helvetica-Bold').fontSize(20).text('Reporte de Productos', { align: 'center' });
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(10).text(`Generado el: ${new Date().toLocaleString()}`, { align: 'center' });
      doc.moveDown(0.5).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
  
      // RESUMEN
      doc.moveDown(0.5).fontSize(12);
      doc.text(`🥇 Producto más vendido: ${masVendido[0]?.nombre_producto || 'Sin datos'}`);
      doc.text(`📦 Stock total: ${totalStock[0]?.total_stock || 0} unidades`);
      doc.moveDown(1);
  
      // CABECERA DE TABLA
      const tableTop = doc.y;
      const itemHeight = 20;
  
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .text("ID", 50, tableTop)
        .text("Nombre", 80, tableTop)
        .text("Descripción", 180, tableTop)
        .text("Precio", 360, tableTop)
        .text("Cantidad", 430, tableTop)
        .text("Estatus", 500, tableTop);
  
      doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();
      doc.moveDown(0.5);
  
      // FILAS
      doc.font('Helvetica').fontSize(10);
      productos.forEach((p, i) => {
        const y = tableTop + 20 + (i * itemHeight);
        doc
          .text(p.id_producto, 50, y)
          .text(p.nombre_producto, 80, y)
          .text(p.descripcion, 180, y, { width: 160 })
          .text(`$${parseFloat(p.precio).toFixed(2)}`, 360, y)
          .text(p.cantidad, 430, y)
          .text(p.estatus === 1 ? 'Activo' : 'Inactivo', 500, y);
      });
  
      doc.end();
    } catch (error) {
      console.error("❌ Error al generar PDF:", error);
      res.status(500).json({ error: "Error al generar el PDF" });
    }
  });
  
// 🧾 Reporte PDF - Ventas (productos + suscripciones)
app.get("/admin/reporte-ventas", async (req, res) => {
    const moment = require("moment");
    const PDFDocument = require("pdfkit");
  
    try {
      const ventas = await db.query(`
        SELECT 
          v.id_venta AS id,
          u.nombre AS cliente,
          DATE_FORMAT(v.fecha_venta, '%d/%m/%Y') AS fecha,
          'Producto' AS tipo,
          v.monto_total AS total
        FROM venta v
        INNER JOIN usuario u ON v.id_usuario = u.id_usuario
  
        UNION
  
        SELECT 
          s.id_suscripcion,
          u.nombre,
          DATE_FORMAT(s.fecha_inicio, '%d/%m/%Y'),
          'Suscripción',
          s.precio
        FROM suscripcion s
        INNER JOIN usuario u ON s.id_usuario = u.id_usuario
        WHERE s.estado = 'Activa'
  
        ORDER BY fecha DESC
      `);
  
      const doc = new PDFDocument({ margin: 50 });
      let totalGeneral = ventas.reduce((acc, v) => acc + parseFloat(v.total), 0);
  
      res.setHeader("Content-Disposition", "attachment; filename=reporte_ventas.pdf");
      res.setHeader("Content-Type", "application/pdf");
  
      doc.fontSize(20).text("📄 Reporte de Ventas", { align: "center" });
      doc.moveDown().fontSize(12).text(`Generado el: ${moment().format('LLL')}`, { align: "center" });
      doc.moveDown().moveTo(50, doc.y).lineTo(550, doc.y).stroke();
  
      // Tabla
      doc.moveDown().fontSize(11);
      const tableTop = doc.y;
      const itemHeight = 20;
  
      // Encabezados
      const columns = [
        { label: "Cliente", x: 50 },
        { label: "Fecha", x: 150 },
        { label: "Tipo", x: 250 },
        { label: "Total", x: 350 },
      ];
  
      doc.font("Helvetica-Bold");
      columns.forEach(col => doc.text(col.label, col.x, tableTop));
      doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();
      doc.font("Helvetica");
  
      // Filas
      let y = tableTop + 25;
      ventas.forEach(v => {
        doc.text(v.cliente, 50, y);
        doc.text(v.fecha, 150, y);
        doc.text(v.tipo, 250, y);
        doc.text(`$${parseFloat(v.total).toFixed(2)}`, 350, y);
        y += itemHeight;
      });
  
      // Línea final y total
      doc.moveTo(50, y).lineTo(550, y).stroke();
      y += 10;
      doc.font("Helvetica-Bold")
        .fillColor("black")
        .text(`💰 Total acumulado: $${totalGeneral.toFixed(2)}`, 50, y);
  
      doc.end();
      doc.pipe(res);
    } catch (error) {
      console.error("❌ Error al generar reporte de ventas:", error);
      res.status(500).json({ error: "Error al generar el PDF" });
    }
  });

  app.get("/factura-producto-pdf/:id_factura", async (req, res) => {
    const { id_factura } = req.params;
    const PDFDocument = require("pdfkit");
  
    try {
      const [factura] = await db.query(
        `SELECT f.id_factura, f.monto, f.fecha_emision, p.nombre_producto, u.nombre AS cliente
         FROM factura f
         JOIN venta v ON f.id_venta = v.id_venta
         JOIN usuario u ON v.id_usuario = u.id_usuario
         JOIN detalle_venta dv ON v.id_venta = dv.id_venta
         JOIN producto p ON dv.id_producto = p.id_producto
         WHERE f.id_factura = ? LIMIT 1`,
        [id_factura]
      );
  
      if (!factura) return res.status(404).json({ error: "Factura no encontrada" });
  
      const doc = new PDFDocument();
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=factura_producto_${id_factura}.pdf`);
      doc.pipe(res);
  
      doc.fontSize(18).text("🧾 Factura de Producto", { align: "center" });
      doc.moveDown();
      doc.fontSize(12).text(`Factura #${id_factura}`);
      doc.text(`Cliente: ${factura.cliente}`);
      doc.text(`Producto: ${factura.nombre_producto}`);
      doc.text(`Monto: $${factura.monto}`);
      doc.text(`Fecha de emisión: ${new Date(factura.fecha_emision).toLocaleDateString()}`);
  
      doc.end();
    } catch (err) {
      console.error("❌ Error generando PDF de factura:", err);
      res.status(500).json({ error: "Error generando la factura PDF" });
    }
  });  

  app.get("/factura-suscripcion-pdf/:id_factura", async (req, res) => {
    const { id_factura } = req.params;
    const PDFDocument = require("pdfkit");
  
    try {
      const [factura] = await db.query(`
        SELECT f.id_factura, f.monto, f.fecha_emision, s.nombre_plan, u.nombre AS cliente
        FROM factura f
        JOIN suscripcion s ON f.id_factura = s.id_factura
        JOIN usuario u ON s.id_usuario = u.id_usuario
        WHERE f.id_factura = ?
        LIMIT 1
      `, [id_factura]);
  
      if (!factura) return res.status(404).json({ error: "Factura no encontrada" });
  
      const doc = new PDFDocument();
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=factura_suscripcion_${id_factura}.pdf`);
      doc.pipe(res);
  
      doc.fontSize(18).text("🧾 Factura de Suscripción", { align: "center" });
      doc.moveDown();
      doc.fontSize(12).text(`Factura #${id_factura}`);
      doc.text(`Cliente: ${factura.cliente}`);
      doc.text(`Plan: ${factura.nombre_plan}`);
      doc.text(`Monto: $${factura.monto}`);
      doc.text(`Fecha de emisión: ${new Date(factura.fecha_emision).toLocaleDateString()}`);
  
      doc.end();
    } catch (err) {
      console.error("❌ Error generando factura de suscripción:", err);
      res.status(500).json({ error: "Error generando la factura de suscripción" });
    }
  });

// ✅ GET: Obtener usuarios con suscripción activa desde la VISTA
app.get('/usuarios-activos', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM VistaUsuariosActivos');
    res.json(result);
  } catch (error) {
    console.error("❌ Error al obtener usuarios activos desde la vista:", error);
    res.status(500).json({ error: "Error al obtener usuarios activos" });
  }
});

// Endpoint /ultima-suscripcion
app.get('/ultima-suscripcion', async (req, res) => {
  try {
    const query = `
      SELECT 
        u.id_usuario, 
        u.nombre, 
        u.correo, 
        u.estatus, 
        u.nombre_rol, 
        v.nombre_plan, 
        DATE(v.fecha_inicio) AS fecha_inicio
      FROM usuario u
      LEFT JOIN vista_ultima_suscripcion v ON u.id_usuario = v.id_usuario
      ORDER BY v.fecha_inicio DESC;
    `;
    const result = await db.query(query);
    res.status(200).json(result);
  } catch (error) {
    console.error("❌ Error al obtener últimas suscripciones:", error);
    res.status(500).json({ error: "Error al obtener últimas suscripciones" });
  }
});

app.listen(PORT, () => {
    console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
