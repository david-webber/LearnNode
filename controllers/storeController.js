const mongoose = require("mongoose");
const Store = mongoose.model('Store');
const multer = require("multer");
const jimp = require("jimp");
const uuid = require("uuid");
const User = require("../models/User");



const multerOptions = {
	storage: multer.memoryStorage(),
	fileFilter(req, file, next) {
		const isPhoto = file.mimetype.startsWith('image/');
		if (isPhoto) {
			next(null, true);
		} else {
			next({
				message: "That file type isn't allowed"
			}, false);
		}
	}
};

exports.homePage = (req, res) => {
	res.render("index");
};

exports.addStore = (req, res) => {
	res.render("editStore", {
		title: "Add Store 💩",
	});
};


exports.upload = multer(multerOptions).single('photo');

exports.resize = async (req, res, next) => {
	// check if there is no new file to resize
	if (!req.file) {
		next(); //skip to next middleware (create/update)
		return
	}
	//get extension of file
	const extension = req.file.mimetype.split('/')[1];
	//set the photo name to uniq + ext (save to biody so its saved in DB)
	req.body.photo = `${uuid.v4()}.${extension}`;
	//now we resize
	const photo = await jimp.read(req.file.buffer);
	// width 800 / autoheight
	await photo.resize(800, jimp.AUTO);
	//save to server
	await photo.write(`./public/uploads/${req.body.photo}`);
	//once we have written photo to filesystem - keep going
	next();
}

exports.createStore = async (req, res) => {
	//get the logged in user for saving in stores author field
	req.body.author = req.user._id;
	const store = await (new Store(req.body)).save();
	req.flash('success', `Successfully Created ${store.name}. Care to leave a review?`);
	res.redirect(`/store/${store.slug}`);
};


exports.getStores = async (req, res) => {
	const page = req.params.page || 1;
	const limit = 4;
	const skip = (page * limit) - limit;
	//query DB for list of all stores
	const storesPromise = Store
	.find()
	.skip(skip)
	.limit(limit)
	.sort({created: 'desc'})

	//get the total number of stores
	const countPromise = Store.count();

	//get the stores (limited) and the count
	const [stores, count] = await Promise.all([storesPromise,countPromise]);

	//get upperbound for pages
	const lastPage = Math.ceil(count / limit);

	//make sure there are stores for the page requested before render
	if(!stores.length && skip){
		req.flash('info', `Hey you asked for page ${page}, but that doesn't exist. So I put you on page ${lastPage}`);
		res.redirect(`/stores/page/${lastPage}`);
		return;

	}

	//render all stores
	res.render('stores', {
		title: 'Stores',
		stores,
		count,
		pages: lastPage,
		page
	});
}


const confirmOwner = (store,user) => {
	if(!store.author.equals(user._id)){
		throw Error('you must own the store to edit it!');
	}
}

exports.editStore = async (req, res) => {
	//1. find the store by id.
	const id = req.params.id;
	const store = await Store.findOne({
		_id: id
	});

	//2. confirm owner of store (for edit)
	confirmOwner(store, req.user);
	//3. render out the edit form for updates
	res.render('editStore', {
		title: `Edit ${store.name}`,
		store,
	})
}

exports.updateStore = async (req, res) => {
	//set location to be a point.
	req.body.location.type = 'Point';


	//1 find and update the store
	const store = await Store.findOneAndUpdate({
		_id: req.params.id
	}, req.body, {
		new: true, // return the new store store instead of old...
		runValidators: true, //make sure data passed is valid from model (created in store.js)
	}).exec();
	req.flash('success', `Successfully updated <strong>${store.name}</strong>. <a href="/store/${store.slug}">View Store ➡️</a>`);
	//2. redirect to the store and tell them it worked
	res.redirect(`/stores/${store._id}/edit`);
};

exports.getStoreBySlug = async (req, res, next) => {
	const store = await Store.findOne({
		slug: req.params.slug
	}).populate('author reviews') //.populate will get the rest of the author details from the id.
	if (!store) {
		return next();
	}
	res.render('store', {
		store,
		title: store.name
	})
}


exports.getStoresByTag = async (req, res) => {
	const tag = req.params.tag;
	const tagQuery = tag || {
		$exists: true
	}
	//get the tags
	const tagsPromise = Store.getTagsList();
	//get the stores with this tag. (picked up from request)
	const storesPromise = Store.find({
		tags: tagQuery
	})

	//get both the tags and the stores with promise all (desctructure into tags and stores)
	const [tags, stores] = await Promise.all([tagsPromise, storesPromise]);

	res.render('tags', {
		tags,
		title: 'Tags',
		tag,
		stores
	});
};


exports.searchStores = async (req,res) => {
	// res.json(req.query);
	//find the stores by looking up the text index
	const stores = await Store
	//find stores that match by query param (searching text index)
	.find({
		$text:{
			$search: req.query.q
		}
	},{
		//Add (prooject) score field to results, scored against text frequency
		score: {$meta : 'textScore'} //score results by query
	})
	//sort results by score field
	.sort(
		{score:
			{$meta: 'textScore'}
		})
	//limit to 5 results
	.limit(5)
	res.json(stores);
}

exports.mapStores = async(req,res)=>{
	//get lat and lng from query params, map over and parsefloat so we have numbers instead of strings
	const coordinates = [req.query.lng,req.query.lat].map(parseFloat);
	const q = {
		location: {
			$near: { //use mongo db near fn
				$geometry: {
					type: 'Point',
					coordinates: coordinates
				},
				$maxDistance: 10000 //10km (10,000m)
			}
		}
	}
	const stores = await Store.find(q).select('slug name description location photo').limit(10);
	res.json(stores);


}

exports.mapPage = (req,res) => {
	res.render('map', {title:'Map'})
}

//toggle heart for user
exports.heartStore = async (req,res) => {
	const hearts = req.user.hearts.map(obj => obj.toString());

	//$pull is remove, $addToSet is unique add
	const operator = hearts.includes(req.params.id)?'$pull':'$addToSet';
	const user = await User
		.findByIdAndUpdate(req.user._id,
		{	[operator]: {hearts: req.params.id}},
		{new: true}	//will return the updated user
	)
	res.json(user)
}

// exports.heartsPage = (req,res) => {
// 	res.render('hearts', {title:'Favourites'})
// }

exports.heartsPage = async (req,res) => {

	const hearted = await Store.find({
		_id: {$in: req.user.hearts}
	});
	//render the hearted stores to the hearts pug file
	// res.render('hearts', {
	// 	title: 'Favourite Stores',
	// 	hearted
	// });
	//didn't need to create a new pug file, could use the existing stores pug file .. DOH

	res.render('stores', {
		title: 'Favourite Stores',
		stores:hearted
	});

}


exports.getTopStores = async (req,res) => {
	const stores = await Store.getTopStores();
	res.render('top', {stores, title:'Top Rated Stores'});
}