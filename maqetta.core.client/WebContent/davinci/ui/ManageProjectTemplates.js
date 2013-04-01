define(["dojo/_base/declare",
        "dojo/_base/lang",
        "dojo/_base/array",
        "dojo/dom-class",
        "dojo/dom-construct",
        "dojo/on",
        "dojo/date/locale",
        "dijit/registry",
        "dijit/_WidgetBase",
        "dijit/_TemplatedMixin",
        "dijit/_WidgetsInTemplateMixin",
        "davinci/library",
        "system/resource",
        "davinci/ui/ProjectTemplates",
        "davinci/workbench/Preferences",
        "davinci/Runtime",
        "davinci/Workbench",
        "dojo/i18n!davinci/ui/nls/ui",
        "dojo/i18n!dijit/nls/common",
        "dojo/text!./templates/ManageProjectTemplates.html",
        "dijit/InlineEditBox",
        "dijit/form/TextBox",
        "dijit/form/Button",
        "dijit/form/ComboBox",
        "dijit/form/CheckBox",
        "dojo/store/Memory"
        
],function(declare, lang, array, domClass, domConstruct, on, locale, registry, 
		_WidgetBase, _TemplatedMixin, _WidgetsInTemplateMixin,
		Library, Resource, 
		ProjectTemplates, Preferences, Runtime, Workbench, uiNLS, commonNLS, templateString,
		InlineEditBox, TextBox, Button, ValidationTextBox, CheckBox, Memory){
	
	// Allow any unicode alpha, dijit, period or hyphen
	// This is validation regex used by server: "^[\p{L}\d\.\-]+$", but browsers don't support \p
	var regex = "^[A-Za-z0-9\.\-]+$";
	
	// These string constants have to match same names in CSS files
	var MPT_ROW = "mpt_row";
	var MPT_NAME = "mpt_name";
	var MPT_DELETE = "mpt_delete";
	var MPT_SHARINGSIMPLE = "mpt_sharingSimple";
	var CELL = "_cell";
	var MPT_READONLY_CLASS = "mpt_readonly";
	var MPT_HIGHLIGHT_CLASS = "mpt_highlight";
	var MPT_DELETE_ROW_CLASS = "mpt_delete_row";
	var MPT_DUPLICATE_NAME_CLASS = "ManageProjectTemplatesDuplicateNamesVisible";
	
	function format(date, fmt){
		return locale.format( date, {selector:"date", datePattern:fmt } );
	};
	function dateOrTime(dateString){
		var date = null;
		try{
			date = new Date(dateString);
		}catch(e){
			
		}
		if(!date){
			return uiNLS.unknown;
		}
		var today = new Date();
		if(today.getUTCFullYear() == date.getUTCFullYear() && today.getUTCMonth() == date.getUTCMonth() && today.getUTCDate() == date.getUTCDate()){
			return format(new Date(date), "h:m:s");
		}else{
			return format(new Date(date), "MMM d, yyyy");
		}
	}
	return dojo.declare("davinci.ui.ManageProjectTemplates", [_WidgetBase,_TemplatedMixin,_WidgetsInTemplateMixin], {
		templateString: templateString,
		_okButton: null,
		
		postMixInProperties: function() {
			var langObj = uiNLS;
			var dijitLangObj = commonNLS;
			dojo.mixin(this, langObj);
			dojo.mixin(this, dijitLangObj);
			this.inherited(arguments);
		},

		postCreate: function(){
			this.inherited(arguments);
			var userEmail = Runtime.getUserEmail();
			var contentDiv = this._templateTableDiv;
			var projectTemplateObject = Runtime.getSiteConfigData("projectTemplates");
			var allProjectTemplates = (projectTemplateObject && projectTemplateObject.templates) ? 
					projectTemplateObject.templates : [];
			// Have to clone because we stuff "deleted" property onto objects,
			// and don't want to have that affect Runtime's version
			this._myProjectTemplates = lang.clone(array.filter(allProjectTemplates, function(template){
				return template.authorEmail == userEmail;
			}));
			var table, tr, td, params;
			if(this._myProjectTemplates.length > 0){
				table = domConstruct.create("table", {}, contentDiv);
				tr  = domConstruct.create("tr", {}, table);
				domConstruct.create("th", {innerHTML:uiNLS.ManageProjectTemplatesHeaderName}, tr);
				domConstruct.create("th", {innerHTML:uiNLS.ManageProjectTemplatesHeaderShared}, tr);
				domConstruct.create("th", {innerHTML:uiNLS.ManageProjectTemplatesHeaderCreatedBy}, tr);
				domConstruct.create("th", {innerHTML:uiNLS.ManageProjectTemplatesHeaderCreatedOn}, tr);
				domConstruct.create("th", {innerHTML:uiNLS.ManageProjectTemplatesHeaderLastModified}, tr);
				domConstruct.create("th", {innerHTML:'&nbsp'}, tr);
				for(var i=0; i<this._myProjectTemplates.length; i++){
					var template = this._myProjectTemplates[i];
					tr  = domConstruct.create("tr", {id:MPT_ROW+i, "class":MPT_ROW}, table);
					var name = template.name;
					td = domConstruct.create("td", {id:MPT_NAME+CELL+i, "class":MPT_NAME+CELL}, tr);
					domConstruct.create("div", {id:MPT_NAME+i, "class":MPT_NAME, innerHTML:name}, td);
					td = domConstruct.create("td", {id:MPT_SHARINGSIMPLE+CELL+i, "class":MPT_SHARINGSIMPLE+CELL}, tr);
					params = {type:'checkbox', id:MPT_SHARINGSIMPLE+i, "class":MPT_SHARINGSIMPLE};
					if(template.sharingSimple=="all"){
						params.checked = 'checked';
					}
					var checkbox = domConstruct.create("input", params, td);
					on(checkbox, "change", function(i, e){
						var checkbox = document.getElementById(MPT_SHARINGSIMPLE+i);
						var cell = document.getElementById(MPT_SHARINGSIMPLE+CELL+i);
						if(checkbox && cell){
							var value = checkbox.checked ? "all" : "none";
							if(value == this._myProjectTemplates[i].sharingSimple){
								domClass.remove(cell, MPT_HIGHLIGHT_CLASS);
							}else{
								domClass.add(cell, MPT_HIGHLIGHT_CLASS);
							}
							this.updateUpdateButton();
						}
					}.bind(this, i));
					domConstruct.create("td", {"class":MPT_READONLY_CLASS, innerHTML:template.authorEmail}, tr);
					domConstruct.create("td", {"class":MPT_READONLY_CLASS, innerHTML:dateOrTime(template.creationTimestamp)}, tr);
					domConstruct.create("td", {"class":MPT_READONLY_CLASS, innerHTML:dateOrTime(template.lastModifyTimestamp)}, tr);
					td = domConstruct.create("td", {id:MPT_DELETE+CELL+i, "class":MPT_DELETE+CELL}, tr);
					params = {type:'button', id:MPT_DELETE+i, "class":MPT_DELETE, value:uiNLS.DEL};
					var button = domConstruct.create("input", params, td);
					on(button, "click", function(i, e){
						this._myProjectTemplates[i].deleted = !this._myProjectTemplates[i].deleted;
						var button = document.getElementById(MPT_DELETE+i);
						var row = document.getElementById(MPT_ROW+i);
						if(button && row){
							if(this._myProjectTemplates[i].deleted){
								domClass.add(row, MPT_DELETE_ROW_CLASS);
							}else{
								domClass.remove(row, MPT_DELETE_ROW_CLASS);
							}
						}
						this.updateDuplicateNameError();
						this.updateUpdateButton();
					}.bind(this, i));
				}
				
			}else{
				contentDiv.innerHTML = uiNLS.ManageProjectTemplatesNoTemplates;
			}
		},
		
		checkForChanges: function(callback){
			var stop = false;
			for(var i=0; i<this._myProjectTemplates.length; i++){
				var template = this._myProjectTemplates[i];
				if(template.deleted){
					stop = callback(i, 'deleted');
					if(stop){
						break;
					}
				}
				var ieb_id= MPT_NAME+i;
				var ieb = registry.byId(ieb_id);
				if(ieb){
					var value = ieb.get("value");
					if(value != template.name){
						stop = callback(i, 'name', value);
						if(stop){
							break;
						}
					}
				}
				var checkbox = document.getElementById(MPT_SHARINGSIMPLE+i);
				if(checkbox){
					var value = checkbox.checked ? "all" : "none";
					if(value != this._myProjectTemplates[i].sharingSimple){
						stop = callback(i, 'sharingSimple', value);
						if(stop){
							break;
						}
					}
				}
			}
		},
		
		updateUpdateButton: function(){
			var disable = true;
			if(!this._anyDuplicateNames){
				// checkForChanges loops through all elements in table
				// and invokes callback if any values are different than their original values
				// For this routine, we just check to see if even one value is different
				this.checkForChanges(function(i, prop, value){
					disable = false;
					return true;	// Stops looping in checkForChanges
				});
			}
			this._okButton.set("disabled", disable);
		},
				
		onShow: function(parentDialog){
			// Add inline edit controls on top of all of the name fields
			// Have to do it in onShow callback because the DOM nodes are only
			// instantiated once the dialog is posted
			for(var i=0; i<this._myProjectTemplates.length; i++){
				var name_id = MPT_NAME+i;
				new InlineEditBox({
					editor: TextBox,
					autoSave: true,
					onChange:function(i){
						var ieb_id= MPT_NAME+i;
						var cell_id = MPT_NAME+CELL+i;
						var ieb = registry.byId(ieb_id);
						var cell = document.getElementById(cell_id);
						if(ieb && cell){
							var value = ieb.get("value");
							if(value == this._myProjectTemplates[i].name){
								domClass.remove(cell, MPT_HIGHLIGHT_CLASS);
							}else{
								domClass.add(cell, MPT_HIGHLIGHT_CLASS);
							}
						}
						this.updateDuplicateNameError();
						this.updateUpdateButton();
					}.bind(this, i)
				}, name_id);
			}
			// Put initial focus on the Cancel button because default focus will go on
			// first name cell (because of the InlineEditBox widgets).
			// Have to use a setTimeout because Dojo has a delay before the dialog
			// is actually on the screen (and changing focus will actually take effect)
			setTimeout(function(){
				this._cancelButton.focus();
			}.bind(this), 1000);
		},
		
		updateDuplicateNameError: function(){
			this._anyDuplicateNames = false;
			for(var i=0; i<this._myProjectTemplates.length; i++){
				var ieb1_id= MPT_NAME+i;
				var ieb1 = registry.byId(ieb1_id);
				var name1 = ieb1 ? ieb1.get("value") : '';
				for(var j=i+1; j<this._myProjectTemplates.length; j++){
					var ieb2_id= MPT_NAME+j;
					var ieb2 = registry.byId(ieb2_id);
					var name2 = ieb2 ? ieb2.get("value") : '';
					if(name1 && name1 == name2){
						this._anyDuplicateNames = true;
						break;
					}
				}
			}
			if(this._anyDuplicateNames){
				domClass.add(this._ManageProjectTemplatesDuplicateNames, MPT_DUPLICATE_NAME_CLASS);
			}else{
				domClass.remove(this._ManageProjectTemplatesDuplicateNames, MPT_DUPLICATE_NAME_CLASS);
			}
		},
		
		okButton: function() {
			var deletes = [];
			var renames = [];
			var sharings = [];
			// checkForChanges loops through all elements in table
			// and invokes callback if any values are different than their original values
			// For this routine, gather change info and stuff into deletes, renames, sharings
			this.checkForChanges(function(i, prop, value){
				if(prop == 'deleted'){
					deletes.push({name:this._myProjectTemplates[i].name});
				}else if(prop == 'name' && value){
					renames.push({name:this._myProjectTemplates[i].name, newName:value});
				}else if(prop == 'sharingSimple' && value){
					sharings.push({name:this._myProjectTemplates[i].name, sharingSimple:value});
				}
			}.bind(this));
			
			// Remove any entries in renames or sharings arrays if the given entry is deleted
			function filterDeletes(item){
				for(var i=0; i<deletes.length; i++){
					if(item.name == deletes[i].name){
						return false;
					}
				}
				return true;
			}
			renames = array.filter(renames, filterDeletes);
			sharings = array.filter(sharings, filterDeletes);
			
			
			// Do sharing changes first, then renames, then deletes
			var mods = sharings.concat(renames);
			
			var okToProceed = false;
			if(mods.length>0 || deletes.length>0){
				var confirmString = uiNLS.ManageProjectTemplateAboutToOccur + "\n\n";
				if(deletes.length>0){
					confirmString += deletes.length + " " + uiNLS.ManageProjectTemplateDeletions + "\n";
				}
				if(mods.length>0){
					confirmString += mods.length + " " + uiNLS.ManageProjectTemplateModifications + "\n";
				}
				confirmString += "\n" + uiNLS.ManageProjectTemplateOKToProceed;
				okToProceed = confirm(confirmString);
			}
			if(okToProceed){
				if(mods.length>0){
					ProjectTemplates.modify(mods);
				}
				if(deletes.length > 0){
					ProjectTemplates.deleteTemplates(deletes);
				}
			}
		},

		cancelButton: function(){
			this.cancel = true;
			this.onClose();
		},

		onClose: function(){}
	});
});

